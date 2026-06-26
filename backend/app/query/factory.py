from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from types import UnionType
from typing import Annotated, Any,  NoReturn, Union, cast, get_args, get_origin
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, SecretStr, create_model
from sqlalchemy import inspect
from sqlalchemy.orm import Mapper
from sqlalchemy.orm.attributes import InstrumentedAttribute
from sqlalchemy.orm.properties import ColumnProperty
from sqlalchemy.sql.elements import ColumnElement

from backend.app.query.identity import IdentitySpec
from backend.app.query.operators import (
    Operator,
    between_parameter_names,
    parameter_name_for,
)
from backend.app.query.options import QueryOptions
from backend.app.query.plans import (
    CompiledExtendedFilter,
    CompiledQueryPlan,
    _operators_by_field,
    build_filter_parameters,
)
from backend.app.query.policies import QueryPolicy
from backend.app.query.search import IlikeSearch
from backend.app.query.schema import OffsetQuerySchema
from backend.app.query.validation import fail_config


@dataclass(frozen=True)
class CompiledListQuery:
    """Contenedor inmutable que une el contrato HTTP (``schema``) con su metadata
    SQLAlchemy compilada (``plan``)."""

    schema: type[OffsetQuerySchema]
    plan: CompiledQueryPlan

RESERVED_QUERY_FIELDS = frozenset({"limit", "offset", "sort", "q"})
# Sufijos de rango heredados que NO pueden aparecer como nombre de campo del schema
# público (evita parámetros ambiguos). Los sufijos de los operadores extendidos de C1
# (_ne, _contains, _on, _from, …) NO se reservan proactivamente aquí: colisionan con
# nombres legítimos (p. ej. ``created_on``) y solo se generan de forma opt-in, así que
# su colisión real la detecta ``_guard_generated_collision`` al generar el parámetro.
GENERATED_SUFFIXES = ("_gte", "_lte", "_in", "_isnull")
RANGE_TYPES = (int, Decimal, date, datetime)
EQUALITY_TYPES = (str, EmailStr, UUID, bool)

# Operadores de fecha de calendario de un solo parámetro (``between`` se trata aparte).
_DATE_SINGLE_OPERATORS = (Operator.ON, Operator.BEFORE, Operator.AFTER)
# Operadores de coincidencia parcial de texto (ILIKE escapado, case-insensitive).
_TEXT_MATCH_ORDER = (Operator.CONTAINS, Operator.STARTS_WITH, Operator.ENDS_WITH)


def make_offset_query_schema(
    *,
    name: str,
    resource_schema: type[BaseModel],
    orm_model: type[Any],
    options: QueryOptions | None = None,
) -> type[OffsetQuerySchema]:
    """API heredada: devuelve únicamente la clase Pydantic del query schema.

    Delega en :func:`compile_list_query` y conserva su retorno histórico
    (``type[OffsetQuerySchema]``) para cualquier caller que espere solo el schema.
    """
    return compile_list_query(
        name=name,
        resource_schema=resource_schema,
        orm_model=orm_model,
        options=options,
    ).schema


def compile_list_query(
    *,
    name: str,
    resource_schema: type[BaseModel],
    orm_model: type[Any],
    options: QueryOptions | None = None,
) -> CompiledListQuery:
    query_options = options or QueryOptions()
    _validate_limits(query_options)
    primary_keys = _primary_key_columns(orm_model)
    field_definitions: dict[str, tuple[Any, Any]] = {}
    all_columns: dict[str, ColumnElement[Any] | InstrumentedAttribute[Any]] = {}
    filter_columns: dict[str, ColumnElement[Any] | InstrumentedAttribute[Any]] = {}
    field_types: dict[str, type[Any]] = {}
    range_fields: set[str] = set()
    sort_columns: dict[str, ColumnElement[Any] | InstrumentedAttribute[Any]] = {}

    for field_name, field_info in resource_schema.model_fields.items():
        _validate_field_name(field_name)

    requested_fields = _requested_fields(query_options)
    _validate_requested_fields(resource_schema, requested_fields)

    for field_name in requested_fields:
        field_info = resource_schema.model_fields[field_name]
        field_type = _compatible_scalar_type(field_name, field_info.annotation)
        all_columns[field_name] = _resolve_column(orm_model, field_name, query_options)
        field_types[field_name] = field_type

    for field_name in _default_sort_fields(query_options):
        if field_name not in all_columns:
            all_columns[field_name] = _resolve_column(orm_model, field_name, query_options)

    for field_name in query_options.filter_fields:
        field_type = field_types[field_name]
        column = all_columns[field_name]

        field_definitions[field_name] = _optional_filter_field(field_type, query_options)
        filter_columns[field_name] = column

        if _supports_range(field_type):
            field_definitions[f"{field_name}_gte"] = (field_type | None, None)
            field_definitions[f"{field_name}_lte"] = (field_type | None, None)
            range_fields.add(field_name)

    if query_options.sort_fields:
        for field_name in query_options.sort_fields:
            sort_columns[field_name] = all_columns[field_name]
    else:
        sort_columns.update(all_columns)

    for pk_name in _primary_key_names(primary_keys):
        if pk_name not in sort_columns and pk_name in resource_schema.model_fields:
            sort_columns[pk_name] = getattr(orm_model, pk_name)

    in_fields = _register_in_filters(field_definitions, all_columns, field_types, query_options)
    null_filter_fields = _register_null_filters(field_definitions, all_columns, query_options)

    extended_filters: list[CompiledExtendedFilter] = []
    for field_name, operators in query_options.field_operators.items():
        extended_filters.extend(
            _register_extended_filters(
                field_name=field_name,
                field_type=field_types[field_name],
                column=all_columns[field_name],
                operators=frozenset(operators),
                field_definitions=field_definitions,
                max_filter_text_length=query_options.max_filter_text_length,
            )
        )

    search_columns = tuple(
        _search_column(field_name, all_columns, field_types)
        for field_name in query_options.search_fields
    )
    if search_columns:
        field_definitions["q"] = (str | None, Field(default=None, min_length=2, max_length=100))

    default_sort = _default_sort(query_options, sort_columns, primary_keys)
    field_definitions["limit"] = (int, Field(default=20, ge=1, le=query_options.max_limit))
    field_definitions["sort"] = (
        str,
        Field(
            default=default_sort,
            min_length=1,
            max_length=query_options.max_sort_length,
            description="Campos de orden separados por coma. Use '-' para orden descendente.",
        ),
    )

    # Legacy: el conjunto público y el orderable coinciden con sort_columns (que ya
    # incluye la PK si su nombre está en el schema). Preserva la PK solicitable.
    return _build_compiled(
        name=name,
        module=resource_schema.__module__,
        model=orm_model,
        field_definitions=field_definitions,
        filter_columns=filter_columns,
        all_columns=all_columns,
        range_fields=range_fields,
        in_fields=in_fields,
        null_filter_fields=null_filter_fields,
        public_sort_columns=sort_columns,
        orderable_columns=sort_columns,
        search_columns=search_columns,
        primary_keys=primary_keys,
        max_sort_terms=query_options.max_sort_terms,
        max_in_values=query_options.max_in_values,
        max_sort_length=query_options.max_sort_length,
        max_filter_text_length=query_options.max_filter_text_length,
        extended_filters=tuple(extended_filters),
        calendar_timezone=_application_timezone(),
    )


def compile_list_query_from_policy(
    *,
    name: str,
    orm_model: type[Any],
    policy: QueryPolicy,
) -> CompiledListQuery:
    """Compila el schema + plan desde una ``QueryPolicy`` (camino nuevo).

    Reutiliza el mismo ensamblado (``_build_compiled``) que el camino ``options``,
    derivando columnas/operadores de los ``FieldSpec`` ya resueltos por la policy.
    """
    field_definitions: dict[str, tuple[Any, Any]] = {}
    all_columns: dict[str, ColumnElement[Any] | InstrumentedAttribute[Any]] = {}
    filter_columns: dict[str, ColumnElement[Any] | InstrumentedAttribute[Any]] = {}
    range_fields: set[str] = set()
    in_fields: set[str] = set()
    null_filter_fields: set[str] = set()
    search_columns_list: list[ColumnElement[Any] | InstrumentedAttribute[Any]] = []
    extended_filters: list[CompiledExtendedFilter] = []

    for spec in policy.fields:
        all_columns[spec.name] = spec.source
        if Operator.EQ in spec.operators:
            filter_columns[spec.name] = spec.source
            field_definitions[spec.name] = _optional_filter_field_with_limit(
                spec.type, policy.limits.max_filter_text_length
            )
        if Operator.GTE in spec.operators:
            field_definitions[f"{spec.name}_gte"] = (spec.type | None, None)
        if Operator.LTE in spec.operators:
            field_definitions[f"{spec.name}_lte"] = (spec.type | None, None)
        if Operator.GTE in spec.operators and Operator.LTE in spec.operators:
            range_fields.add(spec.name)
        if Operator.IN in spec.operators:
            field_definitions[f"{spec.name}_in"] = (
                list[spec.type] | None,
                Field(default=None, min_length=1, max_length=policy.limits.max_in_values),
            )
            in_fields.add(spec.name)
        if Operator.ISNULL in spec.operators:
            field_definitions[f"{spec.name}_isnull"] = (bool | None, None)
            null_filter_fields.add(spec.name)
        extended_filters.extend(
            _register_extended_filters(
                field_name=spec.name,
                field_type=spec.type,
                column=spec.source,
                operators=spec.operators,
                field_definitions=field_definitions,
                max_filter_text_length=policy.limits.max_filter_text_length,
            )
        )
        if spec.searchable:
            search_columns_list.append(spec.source)

    search_columns = tuple(search_columns_list)
    primary_keys = _primary_key_columns(orm_model)

    # Sort público nativo: SOLO los campos declarados en public_sort_fields. La PK
    # queda interna (tie-breaker) salvo que se declare explícitamente como pública.
    public_sort_columns: dict[str, ColumnElement[Any] | InstrumentedAttribute[Any]] = {
        field_name: all_columns[field_name] for field_name in policy.sort.public_sort_fields
    }

    # Orderable: superconjunto que default_order puede usar (orderable_fields
    # explícito, o todos los campos del recurso) más la primary key.
    if policy.sort.orderable_fields is not None:
        orderable_columns: dict[str, ColumnElement[Any] | InstrumentedAttribute[Any]] = {
            field_name: all_columns[field_name] for field_name in policy.sort.orderable_fields
        }
    else:
        orderable_columns = dict(all_columns)
    for pk_name in _primary_key_names(primary_keys):
        if pk_name not in orderable_columns:
            orderable_columns[pk_name] = getattr(orm_model, pk_name)

    if search_columns:
        field_definitions["q"] = (
            str | None,
            Field(default=None, min_length=policy.search.min_len, max_length=policy.search.max_len),
        )

    default_sort = _default_sort_value(
        policy.sort.default_order, orderable_columns, primary_keys, policy.limits.max_sort_terms
    )
    field_definitions["limit"] = (
        int,
        Field(default=policy.pagination.default_limit, ge=1, le=policy.pagination.max_limit),
    )
    field_definitions["sort"] = (
        str,
        Field(
            default=default_sort,
            min_length=1,
            max_length=policy.limits.max_sort_length,
            description="Campos de orden separados por coma. Use '-' para orden descendente.",
        ),
    )

    return _build_compiled(
        name=name,
        module=orm_model.__module__,
        model=orm_model,
        field_definitions=field_definitions,
        filter_columns=filter_columns,
        all_columns=all_columns,
        range_fields=range_fields,
        in_fields=in_fields,
        null_filter_fields=null_filter_fields,
        public_sort_columns=public_sort_columns,
        orderable_columns=orderable_columns,
        search_columns=search_columns,
        primary_keys=primary_keys,
        max_sort_terms=policy.limits.max_sort_terms,
        max_in_values=policy.limits.max_in_values,
        max_sort_length=policy.limits.max_sort_length,
        max_filter_text_length=policy.limits.max_filter_text_length,
        extended_filters=tuple(extended_filters),
        calendar_timezone=_application_timezone(),
    )


def _build_compiled(
    *,
    name: str,
    module: str,
    model: type[Any],
    field_definitions: dict[str, tuple[Any, Any]],
    filter_columns: dict[str, ColumnElement[Any] | InstrumentedAttribute[Any]],
    all_columns: dict[str, ColumnElement[Any] | InstrumentedAttribute[Any]],
    range_fields: set[str],
    in_fields: set[str],
    null_filter_fields: set[str],
    public_sort_columns: dict[str, ColumnElement[Any] | InstrumentedAttribute[Any]],
    orderable_columns: dict[str, ColumnElement[Any] | InstrumentedAttribute[Any]],
    search_columns: tuple[ColumnElement[Any] | InstrumentedAttribute[Any], ...],
    primary_keys: tuple[ColumnElement[Any], ...],
    max_sort_terms: int,
    max_in_values: int,
    max_sort_length: int,
    max_filter_text_length: int,
    extended_filters: tuple[CompiledExtendedFilter, ...] = (),
    calendar_timezone: str = "UTC",
) -> CompiledListQuery:
    """Ensamblado compartido: crea el schema Pydantic, fija ``__query_*__`` (ruta
    heredada / fallback) y construye el ``CompiledQueryPlan``."""
    query_schema = create_model(
        name,
        __base__=OffsetQuerySchema,
        __module__=module,
        **cast(Any, field_definitions),
    )

    # Tie-breakers para estabilidad: la primary key, con su clave de columna como
    # clave lógica de desempate (las claves ya fueron validadas como str usables).
    tie_breakers = tuple((cast(str, primary_key.key), primary_key) for primary_key in primary_keys)

    setattr(query_schema, "model", model)
    setattr(query_schema, "__query_columns__", filter_columns)
    setattr(query_schema, "__query_all_columns__", all_columns)
    setattr(query_schema, "__query_range_fields__", range_fields)
    setattr(query_schema, "__query_in_fields__", in_fields)
    setattr(query_schema, "__query_null_filter_fields__", null_filter_fields)
    # El dunder heredado refleja el conjunto público (lo que el cliente puede pedir).
    setattr(query_schema, "__query_sort_columns__", public_sort_columns)
    setattr(query_schema, "__query_search_columns__", search_columns)
    setattr(query_schema, "__query_primary_keys__", primary_keys)
    setattr(query_schema, "__query_max_sort_terms__", max_sort_terms)

    # Mapeo público de parámetros: orden por campos de all_columns + orden canónico de
    # operadores, validado contra las model_fields reales del schema generado.
    filter_parameters = build_filter_parameters(
        tuple(all_columns.keys()),
        _operators_by_field(
            eq_fields=filter_columns,
            range_fields=range_fields,
            in_fields=in_fields,
            null_filter_fields=null_filter_fields,
        ),
        valid_parameters=frozenset(query_schema.model_fields),
    )

    plan = CompiledQueryPlan(
        filter_columns=filter_columns,
        all_columns=all_columns,
        range_fields=frozenset(range_fields),
        in_fields=frozenset(in_fields),
        null_filter_fields=frozenset(null_filter_fields),
        public_sort_columns=public_sort_columns,
        orderable_columns=orderable_columns,
        tie_breakers=tie_breakers,
        default_order=query_schema.model_fields["sort"].default,
        identity=IdentitySpec(columns=primary_keys),
        search_strategy=IlikeSearch(),
        search_columns=search_columns,
        primary_keys=primary_keys,
        max_sort_terms=max_sort_terms,
        max_in_values=max_in_values,
        max_sort_length=max_sort_length,
        max_filter_text_length=max_filter_text_length,
        filter_parameters=filter_parameters,
        extended_filters=extended_filters,
        calendar_timezone=calendar_timezone,
    )
    return CompiledListQuery(schema=query_schema, plan=plan)


def _application_timezone() -> str:
    """Snapshot de la zona horaria de aplicación (IANA) al compilar el plan.

    Import diferido para no acoplar el motor de query a ``settings`` en import-time y
    para reflejar parches de configuración en pruebas (se lee al compilar, no al
    importar el módulo)."""
    from backend.app.core.settings import settings

    return settings.application_timezone


def _optional_filter_field_with_limit(field_type: type[Any], max_filter_text_length: int) -> tuple[Any, Any]:
    if _is_text_type(field_type):
        return (field_type | None, Field(default=None, max_length=max_filter_text_length))
    return (field_type | None, None)


def _register_in_filters(
    field_definitions: dict[str, tuple[Any, Any]],
    columns: dict[str, ColumnElement[Any] | InstrumentedAttribute[Any]],
    field_types: dict[str, type[Any]],
    options: QueryOptions,
) -> set[str]:
    in_fields: set[str] = set()
    for field_name in options.in_fields:
        _require_filterable_field(field_name, columns, "in")
        generated = f"{field_name}_in"
        _guard_generated_collision(generated, field_definitions)
        field_definitions[generated] = (
            list[field_types[field_name]] | None,
            Field(default=None, min_length=1, max_length=options.max_in_values),
        )
        in_fields.add(field_name)
    return in_fields


def _register_null_filters(
    field_definitions: dict[str, tuple[Any, Any]],
    columns: dict[str, ColumnElement[Any] | InstrumentedAttribute[Any]],
    options: QueryOptions,
) -> set[str]:
    null_filter_fields: set[str] = set()
    for field_name in options.null_filter_fields:
        _require_filterable_field(field_name, columns, "null")
        generated = f"{field_name}_isnull"
        _guard_generated_collision(generated, field_definitions)
        field_definitions[generated] = (bool | None, None)
        null_filter_fields.add(field_name)
    return null_filter_fields


def _register_extended_filters(
    *,
    field_name: str,
    field_type: type[Any],
    column: ColumnElement[Any] | InstrumentedAttribute[Any],
    operators: frozenset[Operator] | set[Operator],
    field_definitions: dict[str, tuple[Any, Any]],
    max_filter_text_length: int,
) -> list[CompiledExtendedFilter]:
    """Genera los parámetros de query y los descriptores compilados de los operadores
    extendidos de C1 (texto y fecha) presentes en ``operators``.

    Fuente única: ``operators`` ya fusiona las listas declarativas y
    ``field_operators``. Solo procesa el subconjunto de C1
    (``ne/contains/starts_with/ends_with/on/before/after/between``); ``eq/gte/lte/in/
    isnull`` los registran las rutas existentes. Valida el tipo por operador y falla en
    config (no en runtime) ante un operador incompatible con el tipo del campo.
    """
    descriptors: list[CompiledExtendedFilter] = []

    # not_equals: complemento lógico de equals sobre valores no nulos. Aplica a
    # cualquier escalar soportado (mismo dominio que eq); el null se gestiona solo con
    # el operador isnull, nunca con una negación ambigua de ILIKE.
    if Operator.NE in operators:
        generated = parameter_name_for(field_name, Operator.NE)
        _guard_generated_collision(generated, field_definitions)
        field_definitions[generated] = _optional_filter_field_with_limit(
            field_type, max_filter_text_length
        )
        descriptors.append(
            CompiledExtendedFilter(field_name, Operator.NE, column, parameter_name=generated)
        )

    # contains / starts_with / ends_with: solo texto (ILIKE escapado, case-insensitive).
    for operator in _TEXT_MATCH_ORDER:
        if operator not in operators:
            continue
        if not _is_text_type(field_type):
            _fail(
                "unsupported_operator_for_type",
                f"El operador '{operator.value}' requiere un campo de texto: '{field_name}'.",
            )
        generated = parameter_name_for(field_name, operator)
        _guard_generated_collision(generated, field_definitions)
        field_definitions[generated] = (str | None, Field(default=None, max_length=max_filter_text_length))
        descriptors.append(
            CompiledExtendedFilter(field_name, operator, column, parameter_name=generated)
        )

    # on / before / after: solo columnas datetime (semántica de día de calendario).
    for operator in _DATE_SINGLE_OPERATORS:
        if operator not in operators:
            continue
        if not _is_calendar_type(field_type):
            _fail(
                "unsupported_operator_for_type",
                f"El operador '{operator.value}' requiere un campo datetime: '{field_name}'.",
            )
        generated = parameter_name_for(field_name, operator)
        _guard_generated_collision(generated, field_definitions)
        field_definitions[generated] = (date | None, None)
        descriptors.append(
            CompiledExtendedFilter(field_name, operator, column, parameter_name=generated)
        )

    # between: dos parámetros (_from, _to), ambos inclusivos para el usuario.
    if Operator.BETWEEN in operators:
        if not _is_calendar_type(field_type):
            _fail(
                "unsupported_operator_for_type",
                f"El operador 'between' requiere un campo datetime: '{field_name}'.",
            )
        from_param, to_param = between_parameter_names(field_name)
        _guard_generated_collision(from_param, field_definitions)
        _guard_generated_collision(to_param, field_definitions)
        field_definitions[from_param] = (date | None, None)
        field_definitions[to_param] = (date | None, None)
        descriptors.append(
            CompiledExtendedFilter(
                field_name,
                Operator.BETWEEN,
                column,
                from_parameter=from_param,
                to_parameter=to_param,
            )
        )

    return descriptors


def _require_filterable_field(
    field_name: str,
    columns: dict[str, ColumnElement[Any] | InstrumentedAttribute[Any]],
    kind: str,
) -> None:
    if field_name not in columns:
        _fail(
            "invalid_schema_column_mapping",
            f"El campo '{field_name}' del filtro '{kind}' no existe en el query schema generado.",
        )


def _validate_limits(options: QueryOptions) -> None:
    for field_name, value in (
        ("max_limit", options.max_limit),
        ("max_in_values", options.max_in_values),
        ("max_sort_terms", options.max_sort_terms),
        ("max_sort_length", options.max_sort_length),
        ("max_filter_text_length", options.max_filter_text_length),
    ):
        if value < 1:
            _fail("invalid_query_options", f"{field_name} debe ser mayor o igual a 1.")


def _requested_fields(options: QueryOptions) -> tuple[str, ...]:
    fields: list[str] = []
    for group in (
        options.filter_fields,
        options.sort_fields,
        options.search_fields,
        options.in_fields,
        options.null_filter_fields,
        tuple(options.field_operators.keys()),
    ):
        fields.extend(group)
    return tuple(dict.fromkeys(fields))


def _default_sort_fields(options: QueryOptions) -> tuple[str, ...]:
    return _sort_field_names(options.default_sort) if options.default_sort else ()


def _validate_requested_fields(resource_schema: type[BaseModel], field_names: tuple[str, ...]) -> None:
    for field_name in field_names:
        if field_name not in resource_schema.model_fields:
            _fail(
                "invalid_schema_column_mapping",
                f"El campo '{field_name}' no existe en el schema público.",
            )


def _optional_filter_field(field_type: type[Any], options: QueryOptions) -> tuple[Any, Any]:
    if _is_text_type(field_type):
        return (field_type | None, Field(default=None, max_length=options.max_filter_text_length))
    return (field_type | None, None)


def _guard_generated_collision(
    generated: str,
    field_definitions: dict[str, tuple[Any, Any]],
) -> None:
    if generated in field_definitions:
        _fail(
            "reserved_query_field_collision",
            f"El parámetro generado '{generated}' colisiona con un campo ya existente.",
        )


def _validate_field_name(field_name: str) -> None:
    if field_name in RESERVED_QUERY_FIELDS:
        _fail(
            "reserved_query_field_collision",
            f"El campo '{field_name}' usa un nombre reservado para query params.",
        )
    if field_name.endswith(GENERATED_SUFFIXES):
        _fail(
            "reserved_query_field_collision",
            f"El campo '{field_name}' colisiona con sufijos generados por filtros de rango.",
        )


def _compatible_scalar_type(field_name: str, annotation: Any) -> type[Any]:
    field_type = _unwrap_optional(_unwrap_annotated(annotation))
    origin = get_origin(field_type)

    if origin is not None:
        _fail(
            "unsupported_schema_field_type",
            f"El campo '{field_name}' usa un tipo compuesto no soportado: {field_type}.",
        )

    if field_type is float or field_type is SecretStr:
        _fail(
            "unsupported_schema_field_type",
            f"El campo '{field_name}' usa un tipo no soportado: {field_type}.",
        )

    if isinstance(field_type, type) and issubclass(field_type, BaseModel):
        _fail(
            "unsupported_schema_field_type",
            f"El campo '{field_name}' usa un schema anidado no soportado.",
        )

    if _is_enum(field_type) or field_type in EQUALITY_TYPES or field_type in RANGE_TYPES:
        return cast(type[Any], field_type)

    _fail(
        "unsupported_schema_field_type",
        f"El campo '{field_name}' usa un tipo no soportado: {field_type}.",
    )


def _unwrap_annotated(annotation: Any) -> Any:
    value = annotation
    while get_origin(value) is Annotated:
        value = get_args(value)[0]
    return value


def _unwrap_optional(annotation: Any) -> Any:
    origin = get_origin(annotation)
    if origin not in (Union, UnionType):
        return annotation

    args = tuple(_unwrap_annotated(arg) for arg in get_args(annotation) if arg is not type(None))
    if len(args) == 1:
        return args[0]
    return annotation


def _resolve_column(
    orm_model: type[Any],
    field_name: str,
    options: QueryOptions,
) -> ColumnElement[Any] | InstrumentedAttribute[Any]:
    if field_name in options.column_bindings:
        column = options.column_bindings[field_name]
        if not _is_queryable_column(column):
            _fail(
                "invalid_column_binding",
                f"El binding de '{field_name}' no es una columna o expresión SQLAlchemy válida.",
            )
        return column

    if not hasattr(orm_model, field_name):
        _fail(
            "invalid_schema_column_mapping",
            f"El campo '{field_name}' no mapea a una columna directa de {orm_model.__name__}.",
        )

    column = getattr(orm_model, field_name)
    if not _is_direct_model_column(column):
        _fail(
            "invalid_schema_column_mapping",
            f"El campo '{field_name}' no mapea a una columna directa de {orm_model.__name__}.",
        )
    return column


def _search_column(
    field_name: str,
    columns: dict[str, ColumnElement[Any] | InstrumentedAttribute[Any]],
    field_types: dict[str, type[Any]],
) -> ColumnElement[Any] | InstrumentedAttribute[Any]:
    if field_name not in columns:
        _fail(
            "invalid_schema_column_mapping",
            f"El campo de búsqueda '{field_name}' no existe en el query schema generado.",
        )
    if not _is_text_type(field_types[field_name]):
        _fail(
            "unsupported_search_field_type",
            f"El campo de búsqueda '{field_name}' no es de tipo texto; ilike no es aplicable.",
        )
    return columns[field_name]


def _primary_key_columns(orm_model: type[Any]) -> tuple[ColumnElement[Any], ...]:
    mapper = cast(Mapper[Any], inspect(orm_model))
    primary_keys = tuple(mapper.primary_key)
    if not primary_keys:
        _fail(
            "missing_primary_key_for_stable_sort",
            f"El modelo {orm_model.__name__} no tiene primary key para orden estable.",
        )
    return cast(tuple[ColumnElement[Any], ...], primary_keys)


def _default_sort(
    options: QueryOptions,
    sort_columns: dict[str, ColumnElement[Any] | InstrumentedAttribute[Any]],
    primary_keys: tuple[ColumnElement[Any], ...],
) -> str:
    return _default_sort_value(
        options.default_sort, sort_columns, primary_keys, options.max_sort_terms
    )


def _default_sort_value(
    raw_default: str | None,
    sort_columns: dict[str, ColumnElement[Any] | InstrumentedAttribute[Any]],
    primary_keys: tuple[ColumnElement[Any], ...],
    max_sort_terms: int,
) -> str:
    if raw_default:
        _validate_default_sort(raw_default, sort_columns, max_sort_terms)
        return raw_default
    if "created_at" in sort_columns:
        return "-created_at"
    primary_key_names = _primary_key_names(primary_keys)
    missing_primary_keys = [field_name for field_name in primary_key_names if field_name not in sort_columns]
    if missing_primary_keys:
        _fail(
            "missing_default_sort",
            "La primary key no existe completa en los campos ordenables; configure default_sort.",
        )
    return ",".join(primary_key_names)


def _validate_default_sort(
    raw_sort: str,
    sort_columns: dict[str, ColumnElement[Any] | InstrumentedAttribute[Any]],
    max_sort_terms: int,
) -> None:
    for field_name in _sort_field_names(raw_sort, error_code="invalid_default_sort", max_sort_terms=max_sort_terms):
        if field_name not in sort_columns:
            _fail("invalid_default_sort", f"No se permite ordenar por '{field_name}' en default_sort.")


def _sort_field_names(
    raw_sort: str,
    *,
    error_code: str = "invalid_default_sort",
    max_sort_terms: int | None = None,
) -> tuple[str, ...]:
    names: list[str] = []
    seen: set[str] = set()
    for raw_term in raw_sort.split(","):
        term = raw_term.strip()
        if not term or term == "-":
            _fail(error_code, "default_sort contiene un campo vacío.")

        field_name = term[1:] if term.startswith("-") else term
        if not field_name:
            _fail(error_code, "default_sort contiene un campo vacío.")
        if field_name in seen:
            _fail(error_code, f"El campo '{field_name}' está duplicado en default_sort.")

        seen.add(field_name)
        names.append(field_name)

    if max_sort_terms is not None and len(names) > max_sort_terms:
        _fail(error_code, f"default_sort no puede incluir más de {max_sort_terms} campos.")
    return tuple(names)


def _primary_key_names(primary_keys: tuple[ColumnElement[Any], ...]) -> tuple[str, ...]:
    names: list[str] = []
    for primary_key in primary_keys:
        primary_key_name = primary_key.key
        if not isinstance(primary_key_name, str) or not primary_key_name:
            _fail(
                "missing_primary_key_for_stable_sort",
                "La primary key no tiene nombre usable para orden estable.",
            )
        names.append(primary_key_name)
    return tuple(names)


def _supports_range(field_type: type[Any]) -> bool:
    return field_type in RANGE_TYPES


def _is_enum(field_type: Any) -> bool:
    return isinstance(field_type, type) and issubclass(field_type, Enum)


def _is_text_type(field_type: Any) -> bool:
    return field_type is str or field_type is EmailStr


def _is_calendar_type(field_type: Any) -> bool:
    """Los operadores de fecha de calendario (on/before/after/between) aplican solo a
    columnas ``datetime`` (semántica de límites de día en la zona de aplicación)."""
    return field_type is datetime


def _is_direct_model_column(value: Any) -> bool:
    return isinstance(value, InstrumentedAttribute) and isinstance(cast(Any, value).property, ColumnProperty)


def _is_queryable_column(value: Any) -> bool:
    return isinstance(value, (ColumnElement, InstrumentedAttribute))


def _fail(code: str, message: str) -> NoReturn:
    fail_config(code, message)
