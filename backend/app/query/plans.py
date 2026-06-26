"""``CompiledQueryPlan``: metadata SQLAlchemy del motor de query, tipada e inmutable.

Pieza **pasiva**: no importa ``factory``, ``compiler`` ni ``executor``, y no genera
schemas. El factory construye el plan; ``compiler``/``executor`` solo lo consumen.

Cuando no se pasa un plan explícito, ``from_schema`` lo reconstruye desde los
atributos ``__query_*__`` que el factory sigue inyectando en el schema generado
(ruta heredada).

El orden tiene tres roles separados (Fase 2, Paso 4):

- ``public_sort_columns`` — campos que el cliente puede pedir con ``?sort=``.
- ``orderable_columns`` — superconjunto que ``default_order`` puede usar (incluye
  columnas internas no públicas).
- ``tie_breakers`` — pares ``(clave_lógica, columna)`` que el compiler añade
  siempre para estabilidad (default: la primary key). El desempate se decide por
  clave lógica, no por identidad de objeto.
"""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Mapping, Sequence

from sqlalchemy.orm.attributes import InstrumentedAttribute
from sqlalchemy.sql.elements import ColumnElement

from backend.app.query.identity import IdentitySpec
from backend.app.query.operators import OPERATOR_ORDER, Operator, parameter_name_for
from backend.app.query.search import IlikeSearch, SearchStrategy
from backend.app.query.validation import fail_config

QueryColumn = ColumnElement[Any] | InstrumentedAttribute[Any]


@dataclass(frozen=True)
class CompiledFilterParameter:
    """Mapeo público inmutable ``(campo, operador) → nombre HTTP del parámetro``.

    Compilado por la factory desde la fuente canónica de operadores; la projection lo
    consume sin reconstruir ni concatenar sufijos.
    """

    field_name: str
    operator: Operator
    parameter_name: str


@dataclass(frozen=True)
class CompiledExtendedFilter:
    """Filtro extendido de C1 (texto/fecha) compilado: operador, columna y nombre(s)
    de parámetro HTTP. Estructura interna del plan (la fuente declarativa pública es
    ``field_operators`` en ``QueryOptions``/``QueryPolicy``); el compiler la aplica y
    la projection la proyecta en el contrato de capacidades.

    ``parameter_name`` aplica a operadores de un solo parámetro
    (``ne/contains/starts_with/ends_with/on/before/after``). ``from_parameter`` y
    ``to_parameter`` aplican solo a ``between`` (dos parámetros, ambos inclusivos para
    el usuario).
    """

    field_name: str
    operator: Operator
    column: QueryColumn
    parameter_name: str | None = None
    from_parameter: str | None = None
    to_parameter: str | None = None


def build_filter_parameters(
    field_order: Sequence[str],
    operators_by_field: Mapping[str, frozenset[Operator]],
    *,
    valid_parameters: frozenset[str],
) -> tuple[CompiledFilterParameter, ...]:
    """Tupla determinista de parámetros públicos de filtro.

    Orden: campos en ``field_order``; por campo, operadores en ``OPERATOR_ORDER``.
    Invariantes: cada ``parameter_name`` existe en ``valid_parameters`` (las
    ``model_fields`` reales del schema) y es único; cada ``(campo, operador)`` es único.
    Una colisión o un parámetro inexistente falla temprano.
    """
    result: list[CompiledFilterParameter] = []
    seen_params: set[str] = set()
    seen_pairs: set[tuple[str, Operator]] = set()
    for field_name in field_order:
        operators = operators_by_field.get(field_name, frozenset())
        for operator in OPERATOR_ORDER:
            if operator not in operators:
                continue
            pair = (field_name, operator)
            if pair in seen_pairs:
                fail_config(
                    "duplicate_filter_parameter",
                    f"El par ({field_name}, {operator.value}) está duplicado en el plan.",
                )
            parameter_name = parameter_name_for(field_name, operator)
            if parameter_name not in valid_parameters:
                fail_config(
                    "missing_filter_parameter",
                    f"El parámetro '{parameter_name}' no existe en el query schema.",
                )
            if parameter_name in seen_params:
                fail_config(
                    "duplicate_filter_parameter",
                    f"El parámetro '{parameter_name}' colisiona entre operadores.",
                )
            seen_pairs.add(pair)
            seen_params.add(parameter_name)
            result.append(CompiledFilterParameter(field_name, operator, parameter_name))
    return tuple(result)


def _operators_by_field(
    *,
    eq_fields: Mapping[str, Any] | frozenset[str] | set[str],
    range_fields: frozenset[str] | set[str],
    in_fields: frozenset[str] | set[str],
    null_filter_fields: frozenset[str] | set[str],
) -> dict[str, frozenset[Operator]]:
    """Agrupa los operadores reales por campo desde los conjuntos del plan."""
    grouped: dict[str, set[Operator]] = {}
    for field_name in eq_fields:
        grouped.setdefault(field_name, set()).add(Operator.EQ)
    for field_name in range_fields:
        grouped.setdefault(field_name, set()).update({Operator.GTE, Operator.LTE})
    for field_name in in_fields:
        grouped.setdefault(field_name, set()).add(Operator.IN)
    for field_name in null_filter_fields:
        grouped.setdefault(field_name, set()).add(Operator.ISNULL)
    return {field_name: frozenset(operators) for field_name, operators in grouped.items()}


@dataclass(frozen=True)
class CompiledQueryPlan:
    filter_columns: Mapping[str, QueryColumn]
    all_columns: Mapping[str, QueryColumn]
    range_fields: frozenset[str]
    in_fields: frozenset[str]
    null_filter_fields: frozenset[str]
    public_sort_columns: Mapping[str, QueryColumn]
    orderable_columns: Mapping[str, QueryColumn]
    tie_breakers: tuple[tuple[str, QueryColumn], ...]
    default_order: str
    identity: IdentitySpec
    search_strategy: SearchStrategy
    search_columns: tuple[QueryColumn, ...]
    primary_keys: tuple[ColumnElement[Any], ...]
    max_sort_terms: int
    # Límites de validación (Pydantic ya los aplica en el schema); se incluyen para
    # que el plan sea autodescriptivo. La ruta heredada (from_schema) no los conoce.
    max_in_values: int | None = None
    max_sort_length: int | None = None
    max_filter_text_length: int | None = None
    # Mapeo público de parámetros de filtro. Default vacío solo por compatibilidad del
    # constructor/fixtures; toda ruta de construcción real lo puebla completo.
    filter_parameters: tuple[CompiledFilterParameter, ...] = ()
    # Filtros extendidos de C1 (texto/fecha) compilados. Vacío en la ruta heredada
    # (from_schema), que no conoce estos operadores.
    extended_filters: tuple[CompiledExtendedFilter, ...] = ()
    # Zona horaria de aplicación (IANA) usada por los operadores de fecha de calendario
    # para resolver límites de día. Snapshot de settings al compilar.
    calendar_timezone: str = "UTC"

    def __post_init__(self) -> None:
        # Snapshot independiente e inmutable: el plan no comparte contenedores
        # mutables con __query_*__, así que mutar la metadata heredada no lo afecta.
        # (Las expresiones de columna SQLAlchemy son inmutables y sí se comparten.)
        object.__setattr__(self, "filter_columns", MappingProxyType(dict(self.filter_columns)))
        object.__setattr__(self, "all_columns", MappingProxyType(dict(self.all_columns)))
        object.__setattr__(self, "public_sort_columns", MappingProxyType(dict(self.public_sort_columns)))
        object.__setattr__(self, "orderable_columns", MappingProxyType(dict(self.orderable_columns)))
        object.__setattr__(self, "range_fields", frozenset(self.range_fields))
        object.__setattr__(self, "in_fields", frozenset(self.in_fields))
        object.__setattr__(self, "null_filter_fields", frozenset(self.null_filter_fields))
        object.__setattr__(self, "search_columns", tuple(self.search_columns))
        object.__setattr__(self, "primary_keys", tuple(self.primary_keys))
        object.__setattr__(self, "tie_breakers", tuple(self.tie_breakers))
        object.__setattr__(self, "filter_parameters", tuple(self.filter_parameters))
        object.__setattr__(self, "extended_filters", tuple(self.extended_filters))

    @classmethod
    def from_schema(cls, query_type: type[Any]) -> CompiledQueryPlan:
        """Reconstruye el plan desde los ``__query_*__`` del schema (ruta heredada).

        En la ruta heredada ``__query_sort_columns__`` es a la vez público y
        orderable (semántica legacy: la PK añadida es solicitable), y los
        tie-breakers son la primary key por su clave de columna.
        """
        sort_columns = query_type.__query_sort_columns__
        primary_keys = tuple(query_type.__query_primary_keys__)
        # Reconstruye el mapping público con el mismo helper canónico que la factory,
        # validando contra las model_fields reales (no por concatenación manual).
        filter_parameters = build_filter_parameters(
            tuple(query_type.__query_all_columns__.keys()),
            _operators_by_field(
                eq_fields=query_type.__query_columns__,
                range_fields=query_type.__query_range_fields__,
                in_fields=query_type.__query_in_fields__,
                null_filter_fields=query_type.__query_null_filter_fields__,
            ),
            valid_parameters=frozenset(query_type.model_fields),
        )
        return cls(
            filter_columns=query_type.__query_columns__,
            all_columns=query_type.__query_all_columns__,
            range_fields=frozenset(query_type.__query_range_fields__),
            in_fields=frozenset(query_type.__query_in_fields__),
            null_filter_fields=frozenset(query_type.__query_null_filter_fields__),
            public_sort_columns=sort_columns,
            orderable_columns=sort_columns,
            tie_breakers=tuple((primary_key.key, primary_key) for primary_key in primary_keys),
            default_order=query_type.model_fields["sort"].default,
            identity=IdentitySpec(columns=primary_keys),
            search_strategy=IlikeSearch(),
            search_columns=tuple(query_type.__query_search_columns__),
            primary_keys=primary_keys,
            max_sort_terms=query_type.__query_max_sort_terms__,
            filter_parameters=filter_parameters,
        )
