from typing import Any, NoReturn
from zoneinfo import ZoneInfo

from sqlalchemy import Select
from sqlalchemy.orm.attributes import InstrumentedAttribute
from sqlalchemy.sql.elements import ColumnElement

from backend.app.query.calendar import day_start_utc, next_day_start_utc
from backend.app.query.operators import Operator
from backend.app.query.plans import CompiledExtendedFilter, CompiledQueryPlan
from backend.app.query.schema import OffsetQuerySchema
from backend.app.query.search import escape_like
from backend.app.query.validation import fail_query

QueryableColumn = ColumnElement[Any] | InstrumentedAttribute[Any]


def apply_query_schema(
    *,
    stmt: Select[Any],
    query: OffsetQuerySchema,
    plan: CompiledQueryPlan | None = None,
) -> Select[Any]:
    # Plan explícito si se proporciona; si no, fallback completo a __query_*__.
    resolved = plan if plan is not None else CompiledQueryPlan.from_schema(type(query))
    filter_columns = resolved.filter_columns
    all_columns = resolved.all_columns
    range_fields = resolved.range_fields
    in_fields = resolved.in_fields
    null_filter_fields = resolved.null_filter_fields
    search_columns = resolved.search_columns

    for field_name, column in filter_columns.items():
        value = getattr(query, field_name)
        if value is not None:
            stmt = _apply_equality_filter(stmt, column, value)

        if field_name in range_fields:
            gte_value = getattr(query, f"{field_name}_gte")
            if gte_value is not None:
                stmt = stmt.where(column >= gte_value)

            lte_value = getattr(query, f"{field_name}_lte")
            if lte_value is not None:
                stmt = stmt.where(column <= lte_value)

    for field_name in in_fields:
        in_values = getattr(query, f"{field_name}_in")
        if in_values:
            stmt = stmt.where(all_columns[field_name].in_(in_values))

    for field_name in null_filter_fields:
        isnull = getattr(query, f"{field_name}_isnull")
        if isnull is not None:
            column = all_columns[field_name]
            stmt = stmt.where(column.is_(None) if isnull else column.isnot(None))

    if resolved.extended_filters:
        stmt = _apply_extended_filters(stmt, query, resolved)

    q = getattr(query, "q", None)
    if q is not None and search_columns:
        stmt = stmt.where(resolved.search_strategy.predicate(search_columns, q))

    if not query.sort:
        _fail("invalid_sort", "El parámetro sort no puede estar vacío.", field_name="sort")
    stmt = _apply_sort(stmt, query.sort, resolved)

    return stmt


def _apply_equality_filter(
    stmt: Select[Any],
    column: QueryableColumn,
    value: Any,
) -> Select[Any]:
    if isinstance(value, bool):
        return stmt.where(column.is_(value))
    return stmt.where(column == value)


def _apply_extended_filters(
    stmt: Select[Any],
    query: OffsetQuerySchema,
    plan: CompiledQueryPlan,
) -> Select[Any]:
    """Aplica los operadores extendidos de C1 (texto y fecha de calendario).

    La zona horaria de calendario se resuelve una sola vez por request desde el plan.
    Cada descriptor se omite si su(s) parámetro(s) vienen ``None`` (no enviados).
    """
    tz = ZoneInfo(plan.calendar_timezone)
    for descriptor in plan.extended_filters:
        column = descriptor.column
        operator = descriptor.operator
        if operator is Operator.NE:
            stmt = _apply_not_equals(stmt, query, descriptor, column)
        elif operator in (Operator.CONTAINS, Operator.STARTS_WITH, Operator.ENDS_WITH):
            stmt = _apply_text_match(stmt, query, descriptor, column)
        elif operator in (Operator.ON, Operator.BEFORE, Operator.AFTER):
            stmt = _apply_calendar_single(stmt, query, descriptor, column, tz)
        elif operator is Operator.BETWEEN:
            stmt = _apply_calendar_between(stmt, query, descriptor, column, tz)
    return stmt


def _apply_not_equals(
    stmt: Select[Any],
    query: OffsetQuerySchema,
    descriptor: CompiledExtendedFilter,
    column: QueryableColumn,
) -> Select[Any]:
    assert descriptor.parameter_name is not None
    value = getattr(query, descriptor.parameter_name)
    if value is None:
        return stmt
    # Complemento lógico de equals sobre valores no nulos: ``column != value`` ya
    # excluye NULL en SQL (NULL != v es desconocido). El null se gestiona con isnull.
    if isinstance(value, bool):
        return stmt.where(column.isnot(value))
    return stmt.where(column != value)


def _apply_text_match(
    stmt: Select[Any],
    query: OffsetQuerySchema,
    descriptor: CompiledExtendedFilter,
    column: QueryableColumn,
) -> Select[Any]:
    assert descriptor.parameter_name is not None
    value = getattr(query, descriptor.parameter_name)
    if value is None:
        return stmt
    escaped = escape_like(value)
    if descriptor.operator is Operator.CONTAINS:
        pattern = f"%{escaped}%"
    elif descriptor.operator is Operator.STARTS_WITH:
        pattern = f"{escaped}%"
    else:  # ENDS_WITH
        pattern = f"%{escaped}"
    return stmt.where(column.ilike(pattern, escape="\\"))


def _apply_calendar_single(
    stmt: Select[Any],
    query: OffsetQuerySchema,
    descriptor: CompiledExtendedFilter,
    column: QueryableColumn,
    tz: ZoneInfo,
) -> Select[Any]:
    assert descriptor.parameter_name is not None
    value = getattr(query, descriptor.parameter_name)
    if value is None:
        return stmt
    if descriptor.operator is Operator.ON:
        return stmt.where(column >= day_start_utc(value, tz)).where(
            column < next_day_start_utc(value, tz)
        )
    if descriptor.operator is Operator.BEFORE:
        return stmt.where(column < day_start_utc(value, tz))
    # AFTER
    return stmt.where(column >= next_day_start_utc(value, tz))


def _apply_calendar_between(
    stmt: Select[Any],
    query: OffsetQuerySchema,
    descriptor: CompiledExtendedFilter,
    column: QueryableColumn,
    tz: ZoneInfo,
) -> Select[Any]:
    # Extremos independientes y opcionales: ``from`` inclusivo (inicio de A); ``to``
    # inclusivo para el usuario (estrictamente menor que el inicio de B+1).
    assert descriptor.from_parameter is not None
    assert descriptor.to_parameter is not None
    from_value = getattr(query, descriptor.from_parameter)
    to_value = getattr(query, descriptor.to_parameter)
    if from_value is not None:
        stmt = stmt.where(column >= day_start_utc(from_value, tz))
    if to_value is not None:
        stmt = stmt.where(column < next_day_start_utc(to_value, tz))
    return stmt


def _apply_sort(
    stmt: Select[Any],
    raw_sort: str,
    plan: CompiledQueryPlan,
) -> Select[Any]:
    # El sort del cliente se valida contra el conjunto público; el default del
    # servidor (orden fijo) se resuelve contra orderable, que puede incluir campos
    # internos no solicitables. Ya fue validado en compile-time.
    is_server_default = raw_sort == plan.default_order
    allowed_columns = plan.orderable_columns if is_server_default else plan.public_sort_columns
    tie_breakers = plan.tie_breakers
    terms = _parse_sort(raw_sort, plan.max_sort_terms)
    requested_fields = {field_name for field_name, _ in terms}

    expressions: list[Any] = []
    for field_name, descending in terms:
        maybe_column = allowed_columns.get(field_name)
        if maybe_column is None:
            _fail(
                "unsupported_sort_field",
                f"No se permite ordenar por '{field_name}'.",
                field_name="sort",
            )
        column = maybe_column
        expressions.append(column.desc().nulls_last() if descending else column.asc().nulls_last())

    # Desempate determinista por clave lógica (no por identidad de objeto): añade
    # los tie-breakers (default: primary key, incl. compuesta) que el cliente no
    # haya pedido ya, para que LIMIT/OFFSET no devuelva subconjuntos arbitrarios.
    last_descending = terms[-1][1]
    for logical_key, column in tie_breakers:
        if logical_key not in requested_fields:
            expressions.append(column.desc() if last_descending else column.asc())

    # La policy reemplaza cualquier ORDER BY previo del stmt base (la ruta conserva
    # JOIN/WHERE/HAVING/scopes; el orden lo gobierna la policy).
    return stmt.order_by(None).order_by(*expressions)


def _parse_sort(raw_sort: str, max_sort_terms: int) -> list[tuple[str, bool]]:
    terms: list[tuple[str, bool]] = []
    seen: set[str] = set()

    for raw_term in raw_sort.split(","):
        term = raw_term.strip()
        if not term or term == "-":
            _fail("invalid_sort", "El parámetro sort contiene un campo vacío.", field_name="sort")

        descending = term.startswith("-")
        field_name = term[1:] if descending else term
        if not field_name:
            _fail("invalid_sort", "El parámetro sort contiene un campo vacío.", field_name="sort")
        if field_name in seen:
            _fail("duplicated_sort_field", f"El campo '{field_name}' está duplicado en sort.", field_name="sort")

        seen.add(field_name)
        terms.append((field_name, descending))

    if len(terms) > max_sort_terms:
        _fail("too_many_sort_fields", f"sort no puede incluir más de {max_sort_terms} campos.", field_name="sort")

    return terms


def _fail(code: str, message: str, field_name: str | None = None) -> NoReturn:
    fail_query(code, message, field_name=field_name)
