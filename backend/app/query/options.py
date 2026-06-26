from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Mapping

from sqlalchemy.orm.attributes import InstrumentedAttribute
from sqlalchemy.sql.elements import ColumnElement

from backend.app.query.operators import Operator

if TYPE_CHECKING:
    from backend.app.query.policies import QueryPolicy

QueryColumn = ColumnElement[Any] | InstrumentedAttribute[Any]


def _empty_column_bindings() -> dict[str, QueryColumn]:
    return {}


def _empty_field_operators() -> dict[str, tuple[Operator, ...]]:
    return {}


@dataclass(frozen=True, slots=True)
class QueryOptions:
    filter_fields: tuple[str, ...] = ()
    sort_fields: tuple[str, ...] = ()
    search_fields: tuple[str, ...] = ()
    in_fields: tuple[str, ...] = ()
    null_filter_fields: tuple[str, ...] = ()
    # Fuente declarativa única de operadores extendidos por campo (texto y fecha de
    # C1: ne/contains/starts_with/ends_with/on/before/after/between). No es una
    # allowlist paralela: se fusiona con los operadores derivados de las listas
    # anteriores en una sola declaración por campo (ver policies.policy_from_options).
    field_operators: Mapping[str, tuple[Operator, ...]] = field(
        default_factory=_empty_field_operators
    )
    column_bindings: Mapping[str, QueryColumn] = field(default_factory=_empty_column_bindings)
    default_sort: str | None = None
    max_limit: int = 100
    max_in_values: int = 100
    max_sort_terms: int = 3
    max_sort_length: int = 200
    max_filter_text_length: int = 200

    def to_policy(self, resource_schema: type[Any], orm_model: type[Any]) -> "QueryPolicy":
        """Traduce esta ``QueryOptions`` (API operativa) a una ``QueryPolicy``
        equivalente. Import diferido para evitar el ciclo con ``policies``/``factory``.
        """
        from backend.app.query.policies import policy_from_options

        return policy_from_options(self, resource_schema, orm_model)
