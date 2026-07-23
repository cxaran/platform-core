"""Contratos de respuesta de paginación, compartidos por toda la API.

Fuente única de ``OffsetPage``/``OffsetPagination``. El motor de query
(``backend.app.query``) los importa desde aquí; así la capa de schemas es la que
define los contratos HTTP y el motor solo los consume.
"""

from typing import Generic, Optional, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")

DEFAULT_LIMIT = 20
MAX_LIMIT = 100


class OffsetPagination(BaseModel):
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)
    offset: int = Field(default=0, ge=0)
    has_next: bool
    # ``total`` es ``None`` cuando el recurso usa ``NoTotalCount`` (feeds grandes que
    # evitan el ``COUNT(*)`` por página): ``has_next`` se resuelve por sobre-lectura y la
    # paginación es de tipo prev/next, sin número de páginas.
    total: Optional[int] = Field(default=None, ge=0)


class OffsetPage(BaseModel, Generic[T]):
    items: list[T]
    pagination: OffsetPagination
