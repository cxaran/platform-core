"""Helpers para construir consultas desde schemas Pydantic."""

from backend.app.query.compiler import apply_query_schema
from backend.app.query.contracts import ListQueryContract
from backend.app.query.executor import paginate
from backend.app.query.factory import (
    CompiledListQuery,
    compile_list_query,
    compile_list_query_from_policy,
    make_offset_query_schema,
)
from backend.app.query.fields import FieldSpec
from backend.app.query.operators import Operator
from backend.app.query.options import QueryOptions
from backend.app.query.plans import CompiledQueryPlan
from backend.app.query.policies import QueryPolicy
from backend.app.query.resource import ResourceQuery
from backend.app.query.schema import (
    OffsetPage,
    OffsetPagination,
    OffsetQuerySchema,
    QuerySchema,
)
from backend.app.query.validation import QueryParameterError, QuerySchemaConfigError

__all__ = [
    "CompiledListQuery",
    "CompiledQueryPlan",
    "FieldSpec",
    "ListQueryContract",
    "OffsetPage",
    "OffsetPagination",
    "OffsetQuerySchema",
    "Operator",
    "QueryOptions",
    "QueryParameterError",
    "QueryPolicy",
    "QuerySchema",
    "QuerySchemaConfigError",
    "ResourceQuery",
    "apply_query_schema",
    "compile_list_query",
    "compile_list_query_from_policy",
    "make_offset_query_schema",
    "paginate",
]
