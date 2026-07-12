"""Respuestas de facetas y agregados de recursos (autofiltro estilo Excel).

Convención de valores: SIEMPRE string (misma regla que ``ResourceFilterOption``),
aunque el tipo real sea entero/booleano/UUID/enum — el cliente los reenvía tal
cual en el parámetro ``{campo}_in`` y Pydantic los coerciona en el backend.
"""

from typing import Optional

from backend.app.schemas.base import ApiReadSchema


class FacetValueRead(ApiReadSchema):
    value: str
    count: int


class ResourceFacetsResponse(ApiReadSchema):
    field: str
    values: list[FacetValueRead]
    # Filas cuyo valor es NULL bajo los mismos filtros (el "(Vacíos)" de Excel). El
    # cliente solo puede ofrecerlo si el campo declara el operador ``isnull``.
    null_count: int
    # El universo real supera el tope: la lista es top-N por frecuencia y el cliente
    # debe ofrecer búsqueda de texto en lugar de fingir completitud.
    has_more: bool
    limit: int


class FieldAggregatesRead(ApiReadSchema):
    sum: Optional[float] = None
    avg: Optional[float] = None
    min: Optional[float] = None
    max: Optional[float] = None


class ResourceStatsResponse(ApiReadSchema):
    # Total de filas bajo el filtro activo (coincide con pagination.total de la lista).
    count: int
    fields: dict[str, FieldAggregatesRead]
