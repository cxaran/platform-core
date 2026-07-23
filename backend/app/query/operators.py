"""Operadores declarativos del modelo de query.

Operadores REALES y el parámetro de query que genera cada uno:

    eq           -> {name}
    ne           -> {name}_ne
    contains     -> {name}_contains      (ILIKE %v%, case-insensitive, escapado)
    starts_with  -> {name}_startswith    (ILIKE v%)
    ends_with    -> {name}_endswith      (ILIKE %v)
    in           -> {name}_in
    not_in       -> {name}_not_in        (complemento de ``in``: lista de valores)
    isnull       -> {name}_isnull
    gt           -> {name}_gt            (mayor estricto; comparación directa)
    gte          -> {name}_gte
    lt           -> {name}_lt            (menor estricto; comparación directa)
    lte          -> {name}_lte
    on           -> {name}_on            (fecha de calendario: día completo)
    before       -> {name}_before        (< inicio del día)
    after        -> {name}_after         (>= inicio del día siguiente)
    between      -> {name}_from + {name}_to   (DOS parámetros; ambos inclusivos)
    contains_any -> {name}_contains_any  (columna ARRAY: solapa cualquiera, ``&&``)
    contains_all -> {name}_contains_all  (columna ARRAY: contiene todos, ``@>``)

``between`` es polimórfico según el tipo del campo: en columnas ``datetime`` usa
límites de día de calendario (dos parámetros ``date``); en columnas numéricas/``date``
compara los extremos directamente (dos parámetros del tipo del campo, ambos inclusivos).

``range`` NO es operador real: atajo de configuración que se normaliza a
``{gte, lte}``. ``searchable`` tampoco: capacidad separada para ``q``.

Los operadores de fecha (``on/before/after/between``) toman un valor ``date``
(``YYYY-MM-DD``) y se compilan contra una columna ``datetime`` usando los límites de
día en la zona horaria de aplicación (ver compiler). Para el usuario, ``between`` es
inclusivo en ambos extremos.

Semántica de texto — asimetría DELIBERADA: ``eq``/``ne`` comparan EXACTO y
case-sensitive (son igualdad y su complemento), mientras que
``contains/starts_with/ends_with`` son ILIKE case-insensitive (coincidencia
parcial). No existe "distinto de, ignorando mayúsculas": sería una negación
ambigua y queda fuera del contrato a propósito.
"""

from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Iterable
from uuid import UUID

from pydantic import EmailStr

from backend.app.query.annotations import is_enum_type


class Operator(str, Enum):
    EQ = "eq"
    NE = "ne"
    CONTAINS = "contains"
    STARTS_WITH = "starts_with"
    ENDS_WITH = "ends_with"
    IN = "in"
    NOT_IN = "not_in"
    ISNULL = "isnull"
    GT = "gt"
    GTE = "gte"
    LT = "lt"
    LTE = "lte"
    ON = "on"
    BEFORE = "before"
    AFTER = "after"
    BETWEEN = "between"
    # Operadores de columna ARRAY (Postgres): ``contains_any`` = solapa (``&&``),
    # ``contains_all`` = contiene (``@>``). Toman una lista del tipo del elemento.
    CONTAINS_ANY = "contains_any"
    CONTAINS_ALL = "contains_all"


# Atajo de configuración (no operador real): se expande a gte + lte.
RANGE = "range"

_RANGE_EXPANSION = (Operator.GTE, Operator.LTE)

# Sufijo del parámetro generado por cada operador de un solo parámetro (eq no añade
# sufijo). ``between`` se trata aparte: genera dos parámetros (_from, _to).
_PARAM_SUFFIX: dict[Operator, str] = {
    Operator.NE: "_ne",
    Operator.CONTAINS: "_contains",
    Operator.STARTS_WITH: "_startswith",
    Operator.ENDS_WITH: "_endswith",
    Operator.IN: "_in",
    Operator.NOT_IN: "_not_in",
    Operator.ISNULL: "_isnull",
    Operator.GT: "_gt",
    Operator.GTE: "_gte",
    Operator.LT: "_lt",
    Operator.LTE: "_lte",
    Operator.ON: "_on",
    Operator.BEFORE: "_before",
    Operator.AFTER: "_after",
    Operator.CONTAINS_ANY: "_contains_any",
    Operator.CONTAINS_ALL: "_contains_all",
}

BETWEEN_FROM_SUFFIX = "_from"
BETWEEN_TO_SUFFIX = "_to"

# Operadores de coincidencia parcial de texto (ILIKE escapado, case-insensitive).
TEXT_MATCH_OPERATORS: frozenset[Operator] = frozenset(
    {Operator.CONTAINS, Operator.STARTS_WITH, Operator.ENDS_WITH}
)

# Operadores de fecha de calendario (valor date, compilados con límites de día en la
# zona horaria de aplicación). ``between`` es de dos parámetros. En columnas numéricas/
# ``date`` ``between`` NO es de calendario: ver ``VALUE_BETWEEN`` en el compiler.
DATE_CALENDAR_OPERATORS: frozenset[Operator] = frozenset(
    {Operator.ON, Operator.BEFORE, Operator.AFTER, Operator.BETWEEN}
)

# Comparación estricta de un solo valor (mayor/menor que), comparación DIRECTA (no
# límites de día): aplica a los tipos de rango (int/Decimal/date/datetime).
STRICT_COMPARISON_OPERATORS: frozenset[Operator] = frozenset({Operator.GT, Operator.LT})

# Operadores de conjunto sobre columnas ARRAY (Postgres). Toman una lista del tipo del
# elemento del array.
ARRAY_OPERATORS: frozenset[Operator] = frozenset(
    {Operator.CONTAINS_ANY, Operator.CONTAINS_ALL}
)

# Orden canónico de operadores para metadata determinista.
OPERATOR_ORDER: tuple[Operator, ...] = (
    Operator.EQ,
    Operator.NE,
    Operator.CONTAINS,
    Operator.STARTS_WITH,
    Operator.ENDS_WITH,
    Operator.GT,
    Operator.GTE,
    Operator.LT,
    Operator.LTE,
    Operator.ON,
    Operator.BEFORE,
    Operator.AFTER,
    Operator.BETWEEN,
    Operator.IN,
    Operator.NOT_IN,
    Operator.CONTAINS_ANY,
    Operator.CONTAINS_ALL,
    Operator.ISNULL,
)


def parameter_name_for(field_name: str, operator: Operator) -> str:
    """Nombre HTTP público del parámetro de un ``(campo, operador)`` de un solo
    parámetro. ``eq`` usa el nombre base; el resto añade su sufijo canónico.

    No aplica a ``between`` (dos parámetros): use :func:`between_parameter_names`.
    """
    return f"{field_name}{_PARAM_SUFFIX.get(operator, '')}"


def between_parameter_names(field_name: str) -> tuple[str, str]:
    """Nombres públicos ``(from, to)`` del operador ``between`` de un campo."""
    return (f"{field_name}{BETWEEN_FROM_SUFFIX}", f"{field_name}{BETWEEN_TO_SUFFIX}")


_TEXT_TYPES = (str, EmailStr)


def normalize_operators(raw: Iterable[Operator | str]) -> frozenset[Operator]:
    """Normaliza una declaración de operadores expandiendo el atajo ``range``."""
    result: set[Operator] = set()
    for item in raw:
        if item == RANGE:
            result.update(_RANGE_EXPANSION)
        elif isinstance(item, Operator):
            result.add(item)
        else:
            result.add(Operator(item))  # ValueError si no es un operador válido
    return frozenset(result)


def default_operators(field_type: type[Any]) -> frozenset[Operator]:
    """Operadores por defecto según el tipo escalar (autoría nativa de policy).

    ``isnull`` (nullable), ``in`` adicionales y los operadores de texto/fecha de C1
    son opt-in explícitos; no se derivan del tipo. El adaptador desde ``QueryOptions``
    deriva los operadores de las listas explícitas y de ``field_operators``.
    """
    if field_type in _TEXT_TYPES:
        return frozenset({Operator.EQ})
    if field_type is bool:
        return frozenset({Operator.EQ})
    if field_type is UUID:
        return frozenset({Operator.EQ, Operator.IN})
    if is_enum_type(field_type):
        return frozenset({Operator.EQ, Operator.IN})
    if field_type in (int, Decimal):
        return frozenset({Operator.EQ, Operator.GTE, Operator.LTE})
    if field_type in (date, datetime):
        return frozenset({Operator.GTE, Operator.LTE})
    return frozenset()


def param_names_for(name: str, operators: frozenset[Operator]) -> set[str]:
    """Nombres de parámetro de query que generan los operadores de un campo."""
    params: set[str] = set()
    if Operator.EQ in operators:
        params.add(name)
    for operator, suffix in _PARAM_SUFFIX.items():
        if operator in operators:
            params.add(f"{name}{suffix}")
    if Operator.BETWEEN in operators:
        from_param, to_param = between_parameter_names(name)
        params.add(from_param)
        params.add(to_param)
    return params
