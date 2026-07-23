"""``RowSerializer``: cómo se obtienen y serializan las filas.

Default ``EntitySerializer`` (entidades ORM). ``ProjectionSerializer`` para
``select`` de columnas; ``CustomSerializer`` para casos arbitrarios. Cada
serializer decide cómo recuperar las filas (``scalars`` vs ``execute``) y cómo
mapearlas al schema de salida.
"""

from typing import Any, Callable, Protocol, Sequence

from sqlalchemy import Select
from sqlalchemy.orm import Session


class RowSerializer(Protocol):
    def rows(self, session: Session, stmt: Select[Any]) -> Sequence[Any]: ...
    def serialize(self, row: Any, item_schema: type[Any]) -> Any: ...


class EntitySerializer:
    """Default: entidades ORM vía ``scalars`` + ``model_validate(from_attributes)``."""

    def rows(self, session: Session, stmt: Select[Any]) -> Sequence[Any]:
        return session.scalars(stmt).all()

    def serialize(self, row: Any, item_schema: type[Any]) -> Any:
        return item_schema.model_validate(row, from_attributes=True)


class ProjectionSerializer:
    """Para ``select`` de columnas/agregados: filas ``Row`` vía ``execute`` +
    ``model_validate(row._mapping)``."""

    def rows(self, session: Session, stmt: Select[Any]) -> Sequence[Any]:
        return session.execute(stmt).all()

    def serialize(self, row: Any, item_schema: type[Any]) -> Any:
        return item_schema.model_validate(row._mapping)


class CustomSerializer:
    """Serializador arbitrario provisto por el contrato."""

    def __init__(
        self,
        serialize_row: Callable[[Any, type[Any]], Any],
        *,
        use_scalars: bool = True,
    ) -> None:
        self._serialize_row = serialize_row
        self._use_scalars = use_scalars

    def rows(self, session: Session, stmt: Select[Any]) -> Sequence[Any]:
        if self._use_scalars:
            return session.scalars(stmt).all()
        return session.execute(stmt).all()

    def serialize(self, row: Any, item_schema: type[Any]) -> Any:
        return self._serialize_row(row, item_schema)
