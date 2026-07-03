"""``QueryPolicy``: política declarativa por recurso (Fase 2, Paso 1).

Sustituye conceptualmente las listas paralelas de ``QueryOptions`` por una regla por
campo (``FieldSpec``) más configuración de sort/búsqueda/paginación/límites.

En el Paso 1 la API operativa sigue siendo ``QueryOptions``; ``policy_from_options``
es el adaptador que la traduce a una ``QueryPolicy`` equivalente. Para garantizar
equivalencia EXACTA con el schema/SQL que genera el factory, el adaptador reutiliza
la introspección del factory (resolución de columna y tipo) en lugar de duplicarla.
"""

from dataclasses import dataclass
from typing import Any

from backend.app.query.fields import FieldSpec
from backend.app.query.operators import Operator

# Defaults heredados del factory actual (no se parametrizan en el Paso 1).
_SEARCH_MIN_LEN = 2
_SEARCH_MAX_LEN = 100
_DEFAULT_LIMIT = 20


@dataclass(frozen=True)
class SortConfig:
    public_sort_fields: tuple[str, ...]
    default_order: str | None
    # Superconjunto interno que ``default_order`` puede usar (incluye campos no
    # públicos). ``None`` = derivar de todos los campos del recurso + la PK.
    orderable_fields: tuple[str, ...] | None = None


@dataclass(frozen=True)
class SearchConfig:
    min_len: int
    max_len: int


@dataclass(frozen=True)
class PaginationConfig:
    default_limit: int
    max_limit: int


@dataclass(frozen=True)
class LimitsConfig:
    max_in_values: int
    max_filter_text_length: int
    max_sort_terms: int
    max_sort_length: int


@dataclass(frozen=True)
class QueryPolicy:
    fields: tuple[FieldSpec, ...]
    sort: SortConfig
    search: SearchConfig
    pagination: PaginationConfig
    limits: LimitsConfig

    def field(self, name: str) -> FieldSpec | None:
        for spec in self.fields:
            if spec.name == name:
                return spec
        return None

    @property
    def searchable_fields(self) -> tuple[str, ...]:
        return tuple(spec.name for spec in self.fields if spec.searchable)

    @property
    def param_names(self) -> set[str]:
        """Conjunto de parámetros de query que un factory equivalente generaría."""
        params: set[str] = {"limit", "offset", "sort"}
        for spec in self.fields:
            params |= spec.param_names
        if self.searchable_fields:
            params.add("q")
        return params


def policy_from_options(
    options: Any,
    resource_schema: type[Any],
    orm_model: type[Any],
) -> QueryPolicy:
    """Adapta una ``QueryOptions`` a una ``QueryPolicy`` equivalente."""
    # Import diferido: rompe el ciclo options -> policies -> factory -> options y
    # reutiliza la MISMA introspección que el factory (equivalencia por construcción).
    from backend.app.query.factory import (
        _compatible_scalar_type,
        _requested_fields,
        _resolve_column,
        _supports_range,
        _validate_field_name,
        _validate_requested_fields,
    )

    for field_name in resource_schema.model_fields:
        _validate_field_name(field_name)

    requested = _requested_fields(options)
    _validate_requested_fields(resource_schema, requested)

    specs: list[FieldSpec] = []
    for name in requested:
        annotation = resource_schema.model_fields[name].annotation
        field_type = _compatible_scalar_type(name, annotation)
        source = _resolve_column(orm_model, name, options)

        operators: set[Operator] = set()
        if name in options.filter_fields:
            operators.add(Operator.EQ)
            if _supports_range(field_type):
                operators.add(Operator.GTE)
                operators.add(Operator.LTE)
        if name in options.in_fields:
            operators.add(Operator.IN)
        if name in options.null_filter_fields:
            operators.add(Operator.ISNULL)
        # Operadores extendidos de C1 declarados por campo (fuente única; se fusionan
        # con los derivados de las listas anteriores, sin allowlist paralela).
        operators.update(options.field_operators.get(name, ()))

        specs.append(
            FieldSpec(
                name=name,
                type=field_type,
                source=source,
                operators=frozenset(operators),
                searchable=name in options.search_fields,
            )
        )

    # Tri-estado de sort_fields (ver QueryOptions): None deriva el sort público de
    # los campos consultables; () es estricto; una tupla es la allowlist exacta.
    public_sort_fields = (
        requested if options.sort_fields is None else tuple(options.sort_fields)
    )
    return QueryPolicy(
        fields=tuple(specs),
        sort=SortConfig(
            public_sort_fields=public_sort_fields,
            default_order=options.default_sort,
        ),
        search=SearchConfig(min_len=_SEARCH_MIN_LEN, max_len=_SEARCH_MAX_LEN),
        pagination=PaginationConfig(default_limit=_DEFAULT_LIMIT, max_limit=options.max_limit),
        limits=LimitsConfig(
            max_in_values=options.max_in_values,
            max_filter_text_length=options.max_filter_text_length,
            max_sort_terms=options.max_sort_terms,
            max_sort_length=options.max_sort_length,
        ),
    )
