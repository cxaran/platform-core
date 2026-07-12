"""Facetas (valores únicos + conteos) y agregados sobre el filtro activo.

Piezas de SOLO LECTURA del motor allowlist: reutilizan el plan compilado y los
predicados del compiler — exactamente la misma semántica de filtros que la lista —
así que no abren ninguna superficie de consulta nueva.

Semántica Excel del autofiltro: la faceta de una columna se calcula EXCLUYENDO el
filtro propio de esa columna (``exclude_field``) y respetando los del resto (y la
búsqueda global ``q``). Los NULL no entran en la lista de valores: se reportan por
separado en ``null_count`` (el "(Vacíos)" de Excel), y el cliente decide si puede
ofrecerlos (según el campo declare ``isnull``).

Los agregados (``aggregate_stats``) sí respetan TODOS los filtros activos: son el
pie de tabla de lo que el usuario está viendo, no del universo completo.
"""

from dataclasses import dataclass
from typing import Any

from sqlalchemy import Select, func
from sqlalchemy.orm import Session

from backend.app.query.compiler import apply_filter_predicates
from backend.app.query.plans import CompiledQueryPlan
from backend.app.query.schema import OffsetQuerySchema
from backend.app.query.validation import fail_query

# Tope duro de valores por faceta: por encima de esto el autofiltro deja de ser una
# lista útil (el cliente ofrece búsqueda de texto en su lugar). ``has_more`` avisa.
FACET_VALUES_LIMIT = 50

# Tope de columnas por consulta de agregados (una fila SQL con 4 funciones por campo).
STATS_FIELDS_LIMIT = 8


@dataclass(frozen=True)
class FacetResult:
    """Valores crudos de la faceta (la serialización a string es del caller)."""

    values: tuple[tuple[Any, int], ...]
    null_count: int
    has_more: bool


@dataclass(frozen=True)
class FieldStats:
    sum: float | None
    avg: float | None
    min: float | None
    max: float | None


@dataclass(frozen=True)
class StatsResult:
    count: int
    fields: dict[str, FieldStats]


def _facet_column(plan: CompiledQueryPlan, field_name: str) -> Any:
    # Facetable = el campo puede consumirse como filtro de igualdad o de conjunto
    # (``eq`` o ``in``). Sin eso, la checklist no tendría cómo aplicarse después.
    if field_name not in plan.filter_columns and field_name not in plan.in_fields:
        fail_query(
            "field_not_facetable",
            f"El campo '{field_name}' no admite autofiltro por valores.",
            field_name=field_name,
        )
    return plan.all_columns[field_name]


def facet_values(
    session: Session,
    *,
    stmt: Select[Any],
    query: OffsetQuerySchema,
    plan: CompiledQueryPlan,
    field_name: str,
    limit: int = FACET_VALUES_LIMIT,
) -> FacetResult:
    """Valores únicos y conteos de una columna bajo los filtros de las DEMÁS.

    Orden estable y útil: primero por frecuencia descendente, luego por valor
    ascendente. Devuelve a lo sumo ``limit`` valores y marca ``has_more`` si el
    universo real es mayor (el cliente muestra su búsqueda en vez de mentir).
    """
    column = _facet_column(plan, field_name)
    filtered = apply_filter_predicates(
        stmt=stmt, query=query, plan=plan, exclude_field=field_name
    )
    count_expr = func.count()
    grouped = (
        filtered.order_by(None)
        .with_only_columns(column, count_expr)
        .where(column.isnot(None))
        .group_by(column)
        .order_by(count_expr.desc(), column.asc())
        .limit(limit + 1)
    )
    rows = session.execute(grouped).all()
    has_more = len(rows) > limit
    values = tuple((value, int(count)) for value, count in rows[:limit])

    null_count = session.execute(
        filtered.order_by(None).with_only_columns(func.count()).where(column.is_(None))
    ).scalar_one()
    return FacetResult(values=values, null_count=int(null_count), has_more=has_more)


def aggregate_stats(
    session: Session,
    *,
    stmt: Select[Any],
    query: OffsetQuerySchema,
    plan: CompiledQueryPlan,
    field_names: tuple[str, ...],
) -> StatsResult:
    """Conteo total + suma/promedio/mín/máx de columnas numéricas bajo TODOS los
    filtros activos. Una sola consulta SQL para todas las columnas pedidas."""
    if len(field_names) > STATS_FIELDS_LIMIT:
        fail_query(
            "too_many_stats_fields",
            f"stats no puede incluir más de {STATS_FIELDS_LIMIT} campos.",
            field_name="fields",
        )
    columns = []
    for name in field_names:
        column = plan.all_columns.get(name)
        if column is None:
            fail_query(
                "field_not_aggregable",
                f"El campo '{name}' no existe en el plan del recurso.",
                field_name=name,
            )
        columns.append(column)

    filtered = apply_filter_predicates(stmt=stmt, query=query, plan=plan)
    expressions: list[Any] = [func.count()]
    for column in columns:
        expressions.extend(
            (func.sum(column), func.avg(column), func.min(column), func.max(column))
        )
    row = session.execute(filtered.order_by(None).with_only_columns(*expressions)).one()

    def _as_float(value: Any) -> float | None:
        return None if value is None else float(value)

    fields: dict[str, FieldStats] = {}
    for index, name in enumerate(field_names):
        base = 1 + index * 4
        fields[name] = FieldStats(
            sum=_as_float(row[base]),
            avg=_as_float(row[base + 1]),
            min=_as_float(row[base + 2]),
            max=_as_float(row[base + 3]),
        )
    return StatsResult(count=int(row[0]), fields=fields)
