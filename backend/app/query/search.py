"""``SearchStrategy``: cómo se aplica el parámetro de búsqueda ``q``.

Interfaz extensible: la estrategia produce un predicado SQLAlchemy a partir de las
columnas buscables y el texto. Tres implementaciones, elegidas por recurso con
``SearchMode`` (``QueryOptions.search_mode``):

- ``ILIKE`` (default): coincidencia parcial case-insensitive, portable (SQLite/Postgres).
- ``UNACCENT``: como ILIKE pero además insensible a acentos ("jose" ↔ "José"). Requiere
  la extensión Postgres ``unaccent``.
- ``TRIGRAM``: similitud difusa (tolerante a erratas) con el operador ``%`` de
  ``pg_trgm``. Requiere la extensión Postgres ``pg_trgm``.

Las dos últimas son SÓLO Postgres (usan funciones/operadores del motor); en SQLite el
default ``ILIKE`` es el único válido. Las extensiones se crean en la migración inicial.
"""

from enum import Enum
from typing import Any, Protocol

from sqlalchemy import func, or_
from sqlalchemy.orm.attributes import InstrumentedAttribute
from sqlalchemy.sql.elements import ColumnElement

QueryColumn = ColumnElement[Any] | InstrumentedAttribute[Any]


class SearchMode(str, Enum):
    ILIKE = "ilike"
    UNACCENT = "unaccent"
    TRIGRAM = "trigram"


class SearchStrategy(Protocol):
    def predicate(self, columns: tuple[QueryColumn, ...], value: str) -> Any: ...


def escape_like(value: str) -> str:
    """Escapa ``\\``, ``%`` y ``_`` para que la búsqueda sea literal, no comodín."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class IlikeSearch:
    """Búsqueda parcial case-insensitive (``ILIKE '%texto%'``) con escape de
    comodines sobre cada columna buscable (OR)."""

    def predicate(self, columns: tuple[QueryColumn, ...], value: str) -> Any:
        pattern = f"%{escape_like(value)}%"
        return or_(*(column.ilike(pattern, escape="\\") for column in columns))


class UnaccentIlikeSearch:
    """Como ``IlikeSearch`` pero insensible a acentos: envuelve columna y patrón en
    ``unaccent(...)`` (extensión Postgres) antes del ILIKE. Los comodines ``%``/``_``/``\\``
    son ASCII: ``unaccent`` no los altera, así que el escape sigue siendo literal."""

    def predicate(self, columns: tuple[QueryColumn, ...], value: str) -> Any:
        pattern = f"%{escape_like(value)}%"
        return or_(
            func.unaccent(column).ilike(func.unaccent(pattern), escape="\\")
            for column in columns
        )


class TrigramSearch:
    """Búsqueda difusa por similitud de trigramas (operador ``%`` de ``pg_trgm``),
    tolerante a erratas. No usa comodines (no es LIKE), así que no escapa el texto; la
    coincidencia depende del umbral de similitud del motor (``pg_trgm.similarity_threshold``)."""

    def predicate(self, columns: tuple[QueryColumn, ...], value: str) -> Any:
        return or_(column.op("%")(value) for column in columns)


def strategy_for(mode: SearchMode) -> SearchStrategy:
    """Estrategia de búsqueda correspondiente al modo declarado por el recurso."""
    if mode is SearchMode.UNACCENT:
        return UnaccentIlikeSearch()
    if mode is SearchMode.TRIGRAM:
        return TrigramSearch()
    return IlikeSearch()
