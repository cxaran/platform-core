"""``IdentitySpec``: expresiones que identifican un recurso único.

Default: las columnas de la primary key. Lo usa el conteo distinto
(``DistinctIdentityCount``). Para proyecciones/agregados sin PK accesible debe
declararse explícitamente; sin identidad no se puede paginar de forma estable.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, cast

from sqlalchemy import inspect
from sqlalchemy.orm import Mapper
from sqlalchemy.orm.attributes import InstrumentedAttribute
from sqlalchemy.sql.elements import ColumnElement

QueryColumn = ColumnElement[Any] | InstrumentedAttribute[Any]


@dataclass(frozen=True)
class IdentitySpec:
    columns: tuple[QueryColumn, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "columns", tuple(self.columns))

    @classmethod
    def from_model(cls, orm_model: type[Any]) -> IdentitySpec:
        mapper = cast(Mapper[Any], inspect(orm_model))
        return cls(columns=tuple(mapper.primary_key))
