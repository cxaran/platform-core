---
name: platform-query-schemas
description: Use when adding or editing list/filter endpoints, building ResourceQuery, QueryOptions, QueryPolicy, FieldSpec, OffsetPage pagination, or Pydantic HTTP contracts (ApiReadSchema/ApiWriteSchema/ApiPatchSchema, XCreate/XRead/XUpdate) in platform-core.
---

# Platform Query & Schemas Toolkit

Reference for the reusable list/filter engine (`backend/app/query`) and the HTTP
contract layer (`backend/app/schemas`). Read alongside `platform-api-conventions`
for routing, RBAC, errors and migrations.

## What lives where

- `backend/app/schemas/` — Pydantic HTTP contracts (bases, error envelope,
  pagination, per-resource schemas).
- `backend/app/query/` — generic allowlist-only engine that turns a resource
  declaration into a filtered/sorted/paginated endpoint.

## When to use which piece

- New list endpoint → **`ListQueryContract`** (`query/contracts.py`) is the main
  abstraction (Fase 2, Paso 3). Declares `model` + output `schema`
  (`XRead`/`XListItem`) + **exactly one** config source: `options=QueryOptions(...)`
  **or** `policy=QueryPolicy(...)` (both, or neither, → `ambiguous_query_config`).
  Exposes `.Query` (an `OffsetQuerySchema` subtype) for `Depends`/`Query()`,
  `.plan` (the `CompiledQueryPlan`), and `.paginate(session, query, stmt=)`. It
  **always passes the explicit `plan`** to the engine (no `__query_*__` fallback).
- **`ResourceQuery`** (`query/resource.py`) is now a thin **compatibility facade**
  over `ListQueryContract` (options only). Same constructor / `.Query` /
  `.paginate()` as before — existing routers use it via
  `paginate_resource(...)` (`api/resource_actions.py`). Prefer `ListQueryContract`
  for new code.
- Custom joins / tenant-scope / extra `WHERE` → pass `stmt=` to `.paginate()`.
  Do not subclass to change the statement; the manual route owns the base stmt.
  `related_stmt(...)` (`api/resource_actions.py`) builds the "list via association
  table" base stmt (e.g. user→roles).
- Declarative policy (Fase 2) → `options.to_policy(resource_schema, orm_model)`
  (`options.py`) produces a `QueryPolicy` equivalent to the options. Feed it to
  `ListQueryContract(policy=...)`, or compile directly with
  `compile_list_query_from_policy(...)` (`factory.py`). Do NOT construct
  `QueryPolicy`/`FieldSpec` by hand unless extending the policy layer; the adapter
  reuses the factory introspection to stay exact (proven by `test_query_policy`).
- Same plan reused, or introspection → `compile_list_query(...)` (`factory.py`)
  returns a `CompiledListQuery` (`.schema` + `.plan`); pass `plan=` to
  `apply_query_schema`/`paginate` to bypass the `__query_*__` fallback.
- Non-paginated or ad-hoc query → `apply_query_schema(stmt, query, plan=)`
  (`compiler.py`) directly on a `Select`.
- Legacy callers expecting only the Pydantic class →
  `make_offset_query_schema(...)` (`factory.py`) returns `type[OffsetQuerySchema]`
  (delegates to `compile_list_query`). Prefer `ListQueryContract`/`compile_list_query`.

Do not mix the two layers blindly: `QueryOptions` is the operational config API
today; `QueryPolicy`/`FieldSpec`/`Operator` is the declarative API (Fase 2). The
factory emits the schema, sets `__query_*__`, and builds a typed immutable
`CompiledQueryPlan` (`query/plans.py`). The compiler/executor use the explicit
`plan` when given and fall back to `__query_*__` only when no `plan` is passed.
Migration tracked in `docs/phase-2-query-policy-design.md`.

## Adding a list endpoint (recipe)

1. Define a module-level `ResourceQuery` (or `ListQueryContract`) — `name`,
   `model` (ORM), `schema` (`XRead`/`XListItem`), `options: QueryOptions`. See
   `api/v1/roles.py` and `api/v1/users_admin.py` for the real pattern.
2. In the router, inject `query: Annotated[MY_RESOURCE.Query, Query()]`.
3. Guard with the permission dependency, then
   `return paginate_resource(MY_RESOURCE, session, query)`
   (`api/resource_actions.py` — thin wrapper over `.paginate()`; pass `stmt=` for
   scopes/joins).
4. Declare `response_model=OffsetPage[XListItem]` (import `OffsetPage` from
   `backend.app.schemas.pagination`, not from `app/query`).

If the resource needs soft-delete/active scoping or a relation join, pass
`stmt=` to `paginate_resource(...)` (e.g. `related_stmt(Role, UserRole, ...)`).

## QueryOptions allowlist (the only fields that become queryable)

| Tuple | Generates | Notes |
|---|---|---|
| `filter_fields` | `{name}` (eq), plus `{name}_gte`/`{name}_lte` for range types | range only for int/Decimal/date/datetime |
| `sort_fields` | `sort` param entries | empty tuple = all filter columns sortable |
| `search_fields` | `q` param (min 2, max 100), `ilike` over those columns | text types only (str/EmailStr) |
| `in_fields` | `{name}_in` (list) | length capped by `max_in_values` |
| `null_filter_fields` | `{name}_isnull` (bool) | `True`→IS NULL, `False`→IS NOT NULL |
| `column_bindings` | maps a field name to a non-direct SQLAlchemy column/expression | use for computed/aliased columns |

Limits (all `>=1`, else `invalid_query_options`): `max_limit` (100),
`max_in_values` (100), `max_sort_terms` (3), `max_sort_length` (200),
`max_filter_text_length` (200). `default_sort` optional but required when the
PK is not fully present in sortable columns.

## Supported vs rejected scalar types

OK: `int`, `Decimal`, `date`, `datetime` (range-capable), `str`, `EmailStr`,
`UUID`, `bool`, `Enum` (equality/in/isnull).
Rejected (config error `unsupported_schema_field_type`): `float`, `SecretStr`,
nested `BaseModel`, any composite/origin type. Optional/`Annotated` wrappers
are unwrapped before the check.

## Sort: three roles + stability (Fase 2, Paso 4)

The plan separates three sort roles (`CompiledQueryPlan`, `query/plans.py`):

- `public_sort_columns` — what the client may request with `?sort=`. Unknown
  field → `unsupported_sort_field` (422).
- `orderable_columns` — superset the **server** `default_order` may use (can
  include internal, non-public fields).
- `tie_breakers` — `(logical_key, column)` pairs the compiler always appends for
  stability (default: the primary key, composite-safe). Dedup is by **logical
  key**, not object identity, so a public sort field that is the PK is not
  duplicated.

`_apply_sort` (`compiler.py`): the client sort is validated against
`public_sort_columns`; the **server default** (when `?sort=` equals the configured
`default_order`) is resolved against `orderable_columns`, so a fixed server order
may use a non-public field. The policy then **replaces** any `ORDER BY` already on
the base stmt (`order_by(None)` first) — the route owns JOIN/WHERE/HAVING/scopes,
the policy owns the order.

**Legacy (options) vs native (policy) PK exposure:** the `QueryOptions`/`ResourceQuery`
path keeps the legacy behavior where the PK is **publicly sortable** (added to
`public_sort_columns`). The native `QueryPolicy` path (`ListQueryContract(policy=)`)
treats the PK as **internal** (tie-breaker only) unless it is explicitly listed in
`public_sort_fields`. This divergence is intentional and lives only in the adapter.

Default sort resolution (`_default_sort_value`, `factory.py`): explicit
`default_order`/`default_sort` (validated against orderable) → else `-created_at`
if orderable → else PK names; raises `missing_default_sort` if the PK is not fully
orderable and no default is given. Per-field error taxonomy stays the same
(`invalid_default_sort` for malformed/duplicate/over-limit/unknown sort terms).

## Errors emitted by the engine

Two exception types, both mapped to 422 by `core/error_handlers.py` using the
`ErrorResponse` envelope (`schemas/error.py`):

- `QuerySchemaConfigError` (`query/validation.py:4`) — raised while building the
  schema (misconfiguration). Codes:
  - `invalid_query_options` — a `max_*` limit is `< 1`.
  - `reserved_query_field_collision` — a resource field name is `limit/offset/sort/q`
    or ends with `_gte/_lte/_in/_isnull`.
  - `reserved_query_field_collision` (generated) — generated param collides with
    an existing field (`_guard_generated_collision`).
  - `invalid_schema_column_mapping` — a requested field is not in the public
    schema, does not map to a direct ORM column, or a filter/in/null/search field
    is missing from the generated columns.
  - `unsupported_schema_field_type` — field type is `float`, `SecretStr`, nested
    `BaseModel`, or a composite type.
  - `unsupported_search_field_type` — a `search_fields` entry is not text.
  - `invalid_column_binding` — a `column_bindings` value is not a SQLAlchemy
    column/expression.
  - `missing_primary_key_for_stable_sort` — ORM model has no PK, or PK has no
    usable name.
  - `invalid_default_sort` — `default_sort` references a non-sortable field, has
    empty/duplicate terms, or exceeds `max_sort_terms`.
  - `missing_default_sort` — PK is not fully sortable and no `default_sort` given.
  - `ambiguous_query_config` — `ListQueryContract` got both `options` and `policy`
    (or neither). Provide exactly one.
- `QueryParameterError` (`query/validation.py:11`) — raised at request time. Has
  `field_name` for the error envelope. Codes:
  - `invalid_sort` — empty/blank sort term.
  - `duplicated_sort_field` — same field twice in `sort`.
  - `too_many_sort_fields` — `sort` terms > `max_sort_terms`.
  - `unsupported_sort_field` — `sort` field not in the allowlist.

Do not catch these in the router; let the handler produce the 422 envelope.

## Pagination contract (do not redefine)

`OffsetPage[T]` / `OffsetPagination` live in `backend/app/schemas/pagination.py`
and are the single source for the HTTP contract. `app/query` re-imports them
(`query/schema.py`, `query/executor.py`, `query/resource.py`). When you need the
page type, import from `app.schemas.pagination`. Constants `DEFAULT_LIMIT=20`,
`MAX_LIMIT=100`. `total` is computed by reusing the exact filtered statement
without `order_by`, so `total` is always coherent with `items`.

## Count / serialize / search strategies (Fase 2, Paso 5)

Opt-in pieces on `ListQueryContract`; defaults reproduce current behavior.

- **CountStrategy** (`query/count_strategies.py`): `AutomaticCount` (default,
  `COUNT(*)` over the filtered subquery) · `DistinctIdentityCount` (`COUNT` over
  `SELECT DISTINCT <identity>` — for joins that duplicate rows; composite-safe) ·
  `CustomCountStatement(build_count)` (receives the filtered stmt, no
  order/offset/limit). Pass via `ListQueryContract(..., count_strategy=...)`.
- **RowSerializer** (`query/serializers.py`): `EntitySerializer` (default,
  `scalars` + `model_validate(from_attributes)`) · `ProjectionSerializer`
  (`execute` + `model_validate(row._mapping)` for `select(columns)`) ·
  `CustomSerializer(fn, use_scalars=...)`. Pass via `row_serializer=...`.
- **SearchStrategy** (`query/search.py`): `IlikeSearch` (default; the only impl —
  trigram/full-text are Fase 8). Pass a custom one via `search_strategy=...`; it
  is baked into the plan (compile-time).
- **IdentitySpec** (`query/identity.py`): `from_model` derives the PK; lives in
  `plan.identity` and powers `DistinctIdentityCount`. For a projection/aggregate
  without an accessible PK, declare it explicitly via `identity=...`.

For 1:N data (not just count), prefer an `EXISTS`/`any()` base stmt over a
multiplying join, or add `distinct()` to the base stmt.

## Schema standards (summary; see platform-api-conventions for full policy)

Bases in `schemas/base.py`:

- `ApiSchema` — root; `populate_by_name`, `str_strip_whitespace`.
- `ApiReadSchema` — add `from_attributes=True`; for `XRead`/`XListItem`.
- `ApiWriteSchema` — add `extra="forbid"`; for `XCreate`/`XReplace`.
- `ApiPatchSchema` — `extra="forbid"`; all fields `Optional[...] = None`;
  consume with `model_dump(exclude_unset=True)`.

Naming per resource: `XBase` (optional reusable fragment), `XCreate`, `XRead`,
`XListItem`, `XUpdate`, `XReplace`, `XQuery` (generated by the query engine, not
hand-written), `XDeleteResult`, `X<Action>Request`/`X<Action>Result`.

Hard rules:

- Schemas are HTTP contracts, not ORM mirrors. Never return an ORM model without
  a `response_model`.
- Input rejection: `extra="forbid"` on writes; do not accept server-controlled
  fields (`id`, timestamps, audit, privilege flags).
- Output from ORM: `from_attributes=True`.
- Declare `response_model` on JSON endpoints.
- Passwords: `SecretStr`; reuse `validate_password` (`schemas/user.py:65`); pair
  `password`/`confirm_password` with a `model_validator` checking equality.

## Alive debt / inconsistencies (do not "fix" by inertia)

- `QueryOptions` (operational) coexists with `QueryPolicy`/`FieldSpec` (Fase 2,
  declarative). Both are generated today; the compiler falls back to
  `__query_*__` when no `plan` is passed. Do not delete `__query_*__` or
  `make_offset_query_schema` while legacy callers remain on that path.
- Phase 2 migration status (see `docs/phase-2-query-policy-design.md`): Paso 1
  (`FieldSpec`/`QueryPolicy`/`to_policy`), Paso 2 (`CompiledQueryPlan`/
  `compile_list_query`/`plan=` path), Paso 3 (`ListQueryContract` +
  `ResourceQuery` facade), Paso 4 (public-sort / orderable / tie-breaker
  separation + `default_order`) and Paso 5 (`IdentitySpec`, count strategies,
  serializers, `SearchStrategy`) are **done**. Pending: `QueryExtension` and the
  advanced Fase 8 items (cursor, full-text/trigram, JSONB, exports). Do not
  pre-implement these.
- Routers are **implemented** and consume the engine: `api/v1/roles.py` and
  `api/v1/users_admin.py` define module-level `ResourceQuery` and call
  `paginate_resource(...)`; `api/v1/users.py` is the self-service profile router.
  `api/v1/permissions.py` lists the catalog. They are no longer stubs.
- `SessionUser` (`schemas/user.py:20`) carries `access_control()` — logic in a
  read schema. It is deliberate (used by auth dependencies); do not strip it
  without a dedicated task.
- `UserResetPassword` (`min_length=6`) vs `ResetPasswordRequest`
  (`min_length=8`) are near-duplicate with divergent password length. Confirm
  intent before unifying.
- Type-hint style is mixed (`typing.Optional/Set/Dict` in `user.py`, `str | None`
  in `role.py`). No formatter is wired; keep the local file's style when editing.

## Verification after changes

- Pyright (config `pyrightconfig.json`): run directly, no npm script.
- Tests are stdlib `unittest` run **by module name** (no `__init__.py` in
  `backend/tests`, so `unittest discover` does not work). See `AGENTS.md` for the
  exact module list. Query-relevant modules: `test_query`, `test_query_helpers`,
  `test_query_integration`, `test_query_policy` (options↔policy equivalence),
  `test_query_plan` (plan vs `__query_*__` equivalence), `test_query_contract`
  (`ListQueryContract`/`ResourceQuery` facade), `test_query_postgres` (needs live
  Postgres — gated by `TEST_POSTGRES_URL` ending in `_test`), `test_error_contract`.
- `test_security_catalog.py` asserts the exact ordered permission list; update it
  when adding permissions.
- `test_auth_routes.py` asserts `/auth/refresh` and `/auth/logout` are absent
  from the OpenAPI schema — keep it green when touching routes.