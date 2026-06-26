"""Acciones genéricas para endpoints CRUD basados en schemas.

Este módulo complementa a ``backend.app.query``: query resuelve listados
filtrables/paginados; estas acciones cubren lectura puntual, creación,
actualización, baja lógica y reemplazo de relaciones simples. Los contratos
HTTP siguen viviendo en ``backend.app.schemas``.
"""

from collections.abc import Callable, Iterable
from typing import Any, NoReturn, TypeVar

from fastapi import HTTPException, status
from sqlalchemy import Select, inspect
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from backend.app.query import OffsetQuerySchema, ResourceQuery
from backend.app.schemas.base import ApiPatchSchema, ApiReadSchema, ApiWriteSchema
from backend.app.schemas.error import ErrorItem, ErrorResponse
from backend.app.schemas.pagination import OffsetPage
from backend.app.security.admin_survival import AdminCoverageError, assert_admin_survival
from backend.app.utils.utc_now import utc_now

TModel = TypeVar("TModel")
TReadSchema = TypeVar("TReadSchema", bound=ApiReadSchema)
TWriteSchema = TypeVar("TWriteSchema", bound=ApiWriteSchema)
TPatchSchema = TypeVar("TPatchSchema", bound=ApiPatchSchema)


def api_error(
    status_code: int,
    code: str,
    message: str,
    *,
    errors: list[ErrorItem] | None = None,
) -> NoReturn:
    """Lanza un HTTPException con el envelope estándar de ``schemas/error.py``."""
    body = ErrorResponse(code=code, message=message, errors=errors)
    raise HTTPException(status_code, detail=body.model_dump(exclude_none=True))


def paginate_resource(
    resource: ResourceQuery[TReadSchema],
    session: Session,
    query: OffsetQuerySchema,
    *,
    stmt: Select[Any] | None = None,
) -> OffsetPage[TReadSchema]:
    """Aplica el motor de query y devuelve ``OffsetPage`` desde su fuente única."""
    return resource.paginate(session, query, stmt=stmt)


def related_stmt(
    target_model: type[Any],
    association_model: type[Any],
    *,
    owner_field: str,
    owner_id: Any,
    target_field: str,
) -> Select[Any]:
    """Statement base para listar entidades relacionadas vía tabla de asociación.

    Equivale a::

        select(target).join(association, association.<target_field> == target.<pk>)
                      .where(association.<owner_field> == owner_id)

    Lado lectura simétrico a ``replace_to_many``. La ruta sigue siendo dueña del
    statement: lo recibe ya armado y puede componerlo con scopes o pasarlo a
    ``paginate_resource(..., stmt=stmt)``.
    """
    target_pk = inspect(target_model).primary_key[0]
    return (
        select(target_model)
        .join(association_model, getattr(association_model, target_field) == target_pk)
        .where(getattr(association_model, owner_field) == owner_id)
    )


def get_or_404(
    session: Session,
    model: type[TModel],
    object_id: Any,
    message: str,
    *,
    code: str = "resource_not_found",
) -> TModel:
    entity = session.get(model, object_id)
    if entity is None:
        api_error(status.HTTP_404_NOT_FOUND, code, message)
    return entity


def serialize(schema: type[TReadSchema], entity: Any) -> TReadSchema:
    return schema.model_validate(entity, from_attributes=True)


def serialize_many(schema: type[TReadSchema], entities: Iterable[Any]) -> list[TReadSchema]:
    return [serialize(schema, entity) for entity in entities]


def serialize_with(
    schema: type[TReadSchema],
    entity: Any,
    values: dict[str, Any],
) -> TReadSchema:
    data = {
        field: getattr(entity, field)
        for field in schema.model_fields
        if field not in values and hasattr(entity, field)
    }
    data.update(values)
    return schema(**data)


def create_entity(
    session: Session,
    model: type[TModel],
    payload: TWriteSchema,
    *,
    exclude: set[str] | None = None,
    values: dict[str, Any] | None = None,
    conflict_message: str,
    conflict_code: str = "resource_conflict",
) -> TModel:
    data = payload.model_dump(exclude=exclude or set())
    data.update(values or {})
    entity = model(**data)
    session.add(entity)
    commit_or_conflict(session, conflict_message, code=conflict_code)
    session.refresh(entity)
    return entity


def patch_entity(
    session: Session,
    entity: TModel,
    payload: TPatchSchema,
    *,
    actor_id: Any | None = None,
    rotate_token_fields: tuple[str, ...] = (),
    token_factory: Callable[[], str] | None = None,
    token_field: str = "token",
    commit: bool = True,
    conflict_message: str,
    conflict_code: str = "resource_conflict",
) -> TModel:
    data = payload.model_dump(exclude_unset=True)
    should_rotate_token = False
    if token_factory is not None and rotate_token_fields:
        should_rotate_token = any(
            field in data and getattr(entity, field) != data[field]
            for field in rotate_token_fields
        )

    assign_values(entity, data)
    if should_rotate_token and token_factory is not None:
        setattr(entity, token_field, token_factory())
    touch_entity(entity, actor_id)
    _persist(session, entity, commit=commit, conflict_message=conflict_message, conflict_code=conflict_code)
    return entity


def update_entity_values(
    session: Session,
    entity: TModel,
    values: dict[str, Any],
    *,
    actor_id: Any | None = None,
    commit: bool = True,
    conflict_message: str,
    conflict_code: str = "resource_conflict",
) -> TModel:
    assign_values(entity, values)
    touch_entity(entity, actor_id)
    _persist(session, entity, commit=commit, conflict_message=conflict_message, conflict_code=conflict_code)
    return entity


def deactivate_entity(
    session: Session,
    entity: TModel,
    *,
    actor_id: Any | None = None,
    active_field: str = "is_active",
    token_factory: Callable[[], str] | None = None,
    token_field: str = "token",
    commit: bool = True,
    inactive_message: str,
    inactive_code: str = "resource_state_conflict",
) -> TModel:
    if not getattr(entity, active_field):
        api_error(status.HTTP_409_CONFLICT, inactive_code, inactive_message)
    setattr(entity, active_field, False)
    if token_factory is not None:
        setattr(entity, token_field, token_factory())
    touch_entity(entity, actor_id)
    _persist(session, entity, commit=commit, conflict_message=inactive_message, conflict_code=inactive_code)
    return entity


def replace_to_many(
    session: Session,
    association_model: type[Any],
    *,
    owner_field: str,
    owner_id: Any,
    target_model: type[TModel],
    target_field: str,
    target_ids: list[Any],
    actor_id: Any | None = None,
    touch: Any | None = None,
    commit: bool = True,
    missing_message: str,
    missing_code: str = "resource_not_found",
    conflict_message: str = "Conflicto al reemplazar la relación",
    conflict_code: str = "relation_conflict",
) -> list[TModel]:
    ids = dedupe(target_ids)
    targets = [
        get_or_404(session, target_model, target_id, missing_message, code=missing_code)
        for target_id in ids
    ]

    existing = session.exec(
        select(association_model).where(getattr(association_model, owner_field) == owner_id)
    ).all()
    for row in existing:
        session.delete(row)
    # Forzar el DELETE antes de los INSERT: si el conjunto nuevo solapa con el
    # anterior, reinsertar la misma clave única en el mismo flush violaría la
    # restricción (SQLAlchemy no garantiza orden delete→insert por sí solo).
    session.flush()

    for target_id in ids:
        values = {
            owner_field: owner_id,
            target_field: target_id,
        }
        if actor_id is not None and hasattr(association_model, "updated_by"):
            values["updated_by"] = actor_id
        session.add(association_model(**values))

    if touch is not None:
        touch_entity(touch, actor_id)
    if commit:
        commit_or_conflict(session, conflict_message, code=conflict_code)
    return targets


def replace_child_values(
    session: Session,
    child_model: type[Any],
    *,
    owner_field: str,
    owner_id: Any,
    value_field: str,
    values: list[Any],
    allowed_values: set[Any] | None = None,
    actor_id: Any | None = None,
    touch: Any | None = None,
    commit: bool = True,
    invalid_message: str,
    invalid_code: str = "invalid_relation_value",
    conflict_message: str = "Conflicto al reemplazar valores relacionados",
    conflict_code: str = "relation_conflict",
) -> list[Any]:
    items = dedupe(values)
    if allowed_values is not None:
        ensure_allowed_values(
            items,
            allowed_values,
            field=value_field,
            message=invalid_message,
            code=invalid_code,
        )

    existing = session.exec(
        select(child_model).where(getattr(child_model, owner_field) == owner_id)
    ).all()
    for row in existing:
        session.delete(row)
    # Ver nota en ``replace_to_many``: garantizar DELETE antes de INSERT evita
    # violar la unicidad cuando el conjunto nuevo solapa con el anterior.
    session.flush()

    for value in items:
        row_values = {
            owner_field: owner_id,
            value_field: value,
        }
        if actor_id is not None and hasattr(child_model, "updated_by"):
            row_values["updated_by"] = actor_id
        session.add(child_model(**row_values))

    if touch is not None:
        touch_entity(touch, actor_id)
    if commit:
        commit_or_conflict(session, conflict_message, code=conflict_code)
    return items


def list_child_values(
    session: Session,
    child_model: type[Any],
    *,
    owner_field: str,
    owner_id: Any,
    value_field: str,
) -> list[Any]:
    """Lee los valores escalares de un hijo para un dueño.

    Lado lectura simétrico a ``replace_child_values`` (p. ej. los permisos
    ``RoleAccess.access`` de un rol). Devuelve la lista de valores.
    """
    column = getattr(child_model, value_field)
    return list(
        session.exec(
            select(column).where(getattr(child_model, owner_field) == owner_id)
        ).all()
    )


def ensure_allowed_values(
    values: list[Any],
    allowed_values: set[Any],
    *,
    field: str,
    message: str,
    code: str = "invalid_value",
) -> None:
    invalid = [value for value in dedupe(values) if value not in allowed_values]
    if invalid:
        errors = [
            ErrorItem(field=field, message=f"Valor no permitido: {value}")
            for value in invalid
        ]
        api_error(status.HTTP_422_UNPROCESSABLE_CONTENT, code, message, errors=errors)


def assign_values(entity: Any, values: dict[str, Any]) -> None:
    for field, value in values.items():
        setattr(entity, field, value)


def touch_entity(entity: Any, actor_id: Any | None) -> None:
    if hasattr(entity, "updated_at"):
        setattr(entity, "updated_at", utc_now())
    if actor_id is not None and hasattr(entity, "updated_by"):
        setattr(entity, "updated_by", actor_id)


def commit_or_conflict(
    session: Session,
    message: str,
    *,
    code: str = "resource_conflict",
) -> None:
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        api_error(status.HTTP_409_CONFLICT, code, message)


def _persist(
    session: Session,
    entity: Any,
    *,
    commit: bool,
    conflict_message: str,
    conflict_code: str,
) -> None:
    """Confirma y refresca, o solo deja el cambio staged para un commit posterior.

    ``commit=False`` difiere el ``commit`` para que una mutación sensible pueda
    validar supervivencia administrativa dentro de la misma transacción antes de
    confirmar (ver :func:`commit_with_admin_survival`)."""
    if commit:
        commit_or_conflict(session, conflict_message, code=conflict_code)
        session.refresh(entity)


def commit_with_admin_survival(
    session: Session,
    *,
    conflict_message: str,
    conflict_code: str = "resource_conflict",
) -> None:
    """Valida supervivencia administrativa y confirma en una sola transacción.

    Aplica el ``flush`` de los cambios staged para que la verificación observe el
    estado resultante; si rompe la invariante, revierte y responde el error estable
    ``admin_coverage_required`` (sin revelar el elemento crítico). Cualquier
    conflicto de integridad se traduce al envelope estándar de conflicto."""
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        api_error(status.HTTP_409_CONFLICT, conflict_code, conflict_message)
    try:
        assert_admin_survival(session)
    except AdminCoverageError as exc:
        session.rollback()
        api_error(status.HTTP_409_CONFLICT, exc.code, exc.message)
    commit_or_conflict(session, conflict_message, code=conflict_code)


def dedupe(values: list[Any]) -> list[Any]:
    seen: set[Any] = set()
    result: list[Any] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result
