"""Capabilities de recursos navegables, filtradas por el usuario actual.

Solo requieren autenticación (``CurrentUser``); no un permiso global adicional. El
listado devuelve únicamente recursos legibles por el usuario; el detalle devuelve el
mismo 404 para un recurso inexistente y para uno no visible (no revela el catálogo).

``/facets`` y ``/stats`` son las piezas de datos del autofiltro estilo Excel y del
pie de totales: exigen el MISMO permiso de lectura que la lista del recurso (mismo
404 opaco si falta) y reinterpretan los parámetros de filtro activos con el MISMO
query schema compilado del recurso — ningún parámetro fuera del contrato entra.
"""

from typing import Any

from enum import Enum
from uuid import UUID

from fastapi import APIRouter, Request, status
from pydantic import ValidationError
from sqlalchemy import select

from backend.app.api.resource_actions import api_error
from backend.app.auth.auth_dependencies import CurrentUser
from backend.app.core.database import SessionDep
from backend.app.query.facets import (
    FACET_VALUES_LIMIT,
    aggregate_stats,
    facet_values,
)
from backend.app.query.schema import OffsetQuerySchema
from backend.app.resources.navigation import visible_navigation_modules
from backend.app.resources.projection import (
    aggregable_field_names,
    build_capability_if_visible,
    build_visible_capabilities,
    facetable_field_names,
)
from backend.app.resources.registry import ResourceDefinition, get_resource
from backend.app.schemas.capabilities import (
    ResourceCapability,
    ResourceCatalogResponse,
)
from backend.app.schemas.facets import (
    FacetValueRead,
    FieldAggregatesRead,
    ResourceFacetsResponse,
    ResourceStatsResponse,
)
from backend.app.schemas.user import SessionUser

router = APIRouter(prefix="/resources", tags=["resources"])


@router.get(
    "",
    response_model=ResourceCatalogResponse,
    response_model_exclude_none=True,
)
def list_resources(current_user: CurrentUser) -> ResourceCatalogResponse:
    """Catálogo de navegación completo, proyectado por permisos.

    ``resources`` son los recursos tabulares/catálogo visibles (contrato CRUD
    genérico); ``navigation_modules`` son los módulos ESPECIALIZADOS (pantallas
    propias como el editor del sitio o el POS) donde el usuario tiene ALGUNO de
    los permisos declarados (*anyOf*)."""
    return ResourceCatalogResponse(
        resources=build_visible_capabilities(current_user),
        navigation_modules=visible_navigation_modules(current_user),
    )


def _readable_definition(resource_name: str, user: SessionUser) -> ResourceDefinition:
    """Definición del recurso si el usuario puede LEERLO; 404 opaco si no.

    Mismo criterio de ocultamiento que el catálogo: recurso inexistente, sin lista
    o sin permiso de lectura devuelven exactamente el mismo error.
    """
    definition = get_resource(resource_name)
    if (
        definition is None
        or definition.list_query is None
        or not definition.read_permission.check(user)
    ):
        api_error(status.HTTP_404_NOT_FOUND, "resource_not_found", "Recurso no encontrado")
    return definition


def _active_filter_query(definition: ResourceDefinition, request: Request) -> OffsetQuerySchema:
    """Reconstruye el query de filtros activos con el schema compilado del recurso.

    Solo entran parámetros que el schema declara (el resto se ignora: ``field`` y
    ``fields`` de estos endpoints viajan junto a los filtros). Los ``{campo}_in``
    se leen como parámetro repetido; un valor inválido responde el mismo 422
    honesto que la lista.
    """
    assert definition.list_query is not None
    schema = definition.list_query.Query
    plan = definition.list_query.plan
    data: dict[str, Any] = {}
    for name in schema.model_fields:
        if name in ("limit", "offset"):
            continue
        values = request.query_params.getlist(name)
        if not values:
            continue
        if name.endswith("_in") and name[: -len("_in")] in plan.in_fields:
            data[name] = values
        else:
            data[name] = values[0]
    try:
        return schema(**data)
    except ValidationError as error:
        first = error.errors()[0] if error.errors() else {}
        parameter = ".".join(str(part) for part in first.get("loc", ())) or None
        api_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "invalid_query",
            f"Parámetro de filtro inválido{f' ({parameter})' if parameter else ''}.",
        )


def _facet_value_as_string(value: Any) -> str:
    """Serializa un valor de faceta con la MISMA forma que el cliente reenvía en
    ``{campo}_in`` (convención string de ResourceFilterOption)."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, Enum):
        return str(value.value)
    if isinstance(value, UUID):
        return str(value)
    return str(value)


@router.get(
    "/{resource_name}/facets",
    response_model=ResourceFacetsResponse,
)
def get_resource_facets(
    resource_name: str,
    field: str,
    request: Request,
    session: SessionDep,
    current_user: CurrentUser,
) -> ResourceFacetsResponse:
    """Valores únicos + conteos de una columna bajo los filtros de las demás."""
    definition = _readable_definition(resource_name, current_user)
    if field not in facetable_field_names(definition):
        api_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "field_not_facetable",
            f"El campo '{field}' no admite autofiltro por valores.",
        )
    assert definition.list_query is not None
    query = _active_filter_query(definition, request)
    result = facet_values(
        session,
        stmt=select(definition.list_query.model),
        query=query,
        plan=definition.list_query.plan,
        field_name=field,
    )
    return ResourceFacetsResponse(
        field=field,
        values=[
            FacetValueRead(value=_facet_value_as_string(value), count=count)
            for value, count in result.values
        ],
        null_count=result.null_count,
        has_more=result.has_more,
        limit=FACET_VALUES_LIMIT,
    )


@router.get(
    "/{resource_name}/stats",
    response_model=ResourceStatsResponse,
)
def get_resource_stats(
    resource_name: str,
    fields: str,
    request: Request,
    session: SessionDep,
    current_user: CurrentUser,
) -> ResourceStatsResponse:
    """Conteo + agregados de columnas numéricas bajo TODOS los filtros activos."""
    definition = _readable_definition(resource_name, current_user)
    requested = tuple(name.strip() for name in fields.split(",") if name.strip())
    if not requested:
        api_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "invalid_query",
            "Indique al menos un campo en 'fields'.",
        )
    allowed = aggregable_field_names(definition)
    for name in requested:
        if name not in allowed:
            api_error(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "field_not_aggregable",
                f"El campo '{name}' no admite agregados.",
            )
    assert definition.list_query is not None
    query = _active_filter_query(definition, request)
    result = aggregate_stats(
        session,
        stmt=select(definition.list_query.model),
        query=query,
        plan=definition.list_query.plan,
        field_names=requested,
    )
    return ResourceStatsResponse(
        count=result.count,
        fields={
            name: FieldAggregatesRead(
                sum=stats.sum, avg=stats.avg, min=stats.min, max=stats.max
            )
            for name, stats in result.fields.items()
        },
    )


@router.get(
    "/{resource_name}",
    response_model=ResourceCapability,
    response_model_exclude_none=True,
)
def get_resource_capability(
    resource_name: str,
    current_user: CurrentUser,
) -> ResourceCapability:
    capability = build_capability_if_visible(resource_name, current_user)
    if capability is None:
        api_error(status.HTTP_404_NOT_FOUND, "resource_not_found", "Recurso no encontrado")
    return capability
