"""Motor de consultas de listados: de una declaración por recurso a SQL seguro.

Mapa del paquete (el flujo va de arriba hacia abajo):

    Declarar    options.py / policies.py + fields.py   qué campos, operadores y
                                                        búsqueda expone un recurso
    Compilar    factory.py (via contracts.py)           al importar: schema de query
                                                        params + CompiledQueryPlan
                                                        (plans.py); config inválida
                                                        = no arranca
    Aplicar     compiler.py (+ operators/calendar/      filtros, búsqueda `q`, sort
                search/validation)                      público y desempate estable
    Ejecutar    executor.py (+ count_strategies/        total + filas + página
                serializers/identity)                   OffsetPage
    Facetas     facets.py                               autofiltro estilo Excel y
                                                        agregados sobre el mismo plan

La regla de seguridad es allowlist: solo lo declarado se convierte en query param
(extra="forbid"); lo no declarado permanece prohibido. Un parámetro mal usado
responde 422 (QueryParameterError); una declaración mal hecha revienta al importar
(QuerySchemaConfigError).

Punto de entrada habitual: ``ResourceQuery`` (= ``ListQueryContract``) en
contracts.py; instancias por recurso en ``resources/registry.py``.
"""

from backend.app.query.compiler import apply_query_schema
from backend.app.query.contracts import ListQueryContract, ResourceQuery
from backend.app.query.count_strategies import (
    AutomaticCount,
    CountStrategy,
    CustomCountStatement,
    DistinctIdentityCount,
    NoTotalCount,
)
from backend.app.query.executor import paginate
from backend.app.query.factory import (
    CompiledListQuery,
    compile_list_query,
    compile_list_query_from_policy,
    make_offset_query_schema,
)
from backend.app.query.fields import FieldSpec
from backend.app.query.identity import IdentitySpec
from backend.app.query.operators import Operator
from backend.app.query.options import QueryOptions
from backend.app.query.plans import CompiledQueryPlan
from backend.app.query.policies import QueryPolicy
from backend.app.query.search import IlikeSearch, SearchStrategy
from backend.app.query.serializers import (
    CustomSerializer,
    EntitySerializer,
    ProjectionSerializer,
    RowSerializer,
)
from backend.app.query.schema import (
    OffsetPage,
    OffsetPagination,
    OffsetQuerySchema,
    QuerySchema,
)
from backend.app.query.validation import QueryParameterError, QuerySchemaConfigError

__all__ = [
    "AutomaticCount",
    "CompiledListQuery",
    "CompiledQueryPlan",
    "CountStrategy",
    "CustomCountStatement",
    "CustomSerializer",
    "DistinctIdentityCount",
    "NoTotalCount",
    "EntitySerializer",
    "FieldSpec",
    "IdentitySpec",
    "IlikeSearch",
    "ListQueryContract",
    "OffsetPage",
    "OffsetPagination",
    "OffsetQuerySchema",
    "Operator",
    "ProjectionSerializer",
    "QueryOptions",
    "QueryParameterError",
    "QueryPolicy",
    "QuerySchema",
    "QuerySchemaConfigError",
    "ResourceQuery",
    "RowSerializer",
    "SearchStrategy",
    "apply_query_schema",
    "compile_list_query",
    "compile_list_query_from_policy",
    "make_offset_query_schema",
    "paginate",
]
