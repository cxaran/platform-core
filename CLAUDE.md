# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Monorepo with a Docker Compose stack: `nginx` (reverse proxy) → `frontend` + `backend`, plus `redis` and `postgres`.

- `backend/` — FastAPI application. **This is the only implemented part.**
- `frontend/` — empty placeholder; Compose builds it as a Next.js-style dev/prod image but no source exists yet.
- `nginx/nginx.conf` — routes `/api/` to backend:8000 and everything else to frontend:3000.
- `compose.yml` (prod) / `compose.dev.yml` (dev) — both read env from `${APP_ENV_FILE:-.env}`; dev also injects inline env vars and runs Postgres + Mailpit.

## Critical convention: imports are absolute from `backend.`

Every module imports as `from backend.app... import ...`. The top-level package is **`backend`** (its parent, the repo root, must be on `PYTHONPATH`). Consequences:

- Always run commands **from the repo root** (`platform-core/`), not from `backend/`.
- The ASGI app path is `backend.app.main:app` (the `Dockerfile` copies the source to `/app/backend/` with `PYTHONPATH=/app`, so this resolves both locally and in-container).

## Commands

Run everything from the repo root. Python deps live in `backend/venv` (activate it or use `backend/venv/Scripts/python`).

```powershell
# Run the API locally (needs Postgres + Redis reachable and env vars set)
uvicorn backend.app.main:app --reload

# Tests (stdlib unittest; tests/ has no __init__.py, so run modules by name, not `discover`)
python -m unittest backend.tests.test_query backend.tests.test_query_helpers backend.tests.test_query_integration backend.tests.test_query_policy backend.tests.test_query_plan backend.tests.test_query_contract backend.tests.test_error_contract backend.tests.test_query_postgres backend.tests.test_security_catalog backend.tests.test_auth_routes
python -m unittest backend.tests.test_security_catalog          # single module
python -m unittest backend.tests.test_security_catalog.SecurityCatalogTest.test_catalog_permissions_are_unique  # single test

# Database migrations (Alembic config lives in backend/, points at backend/alembic)
alembic -c backend/alembic.ini revision --autogenerate -m "message"
alembic -c backend/alembic.ini upgrade head

# Full stack
docker compose -f compose.dev.yml up --build                    # dev: postgres + mailpit + backend
docker compose -f compose.dev.yml --profile migrate up migrate  # run migrations in-container
docker compose up --build                                       # prod stack
```

API docs: `/api/docs`, `/api/redoc`, `/api/openapi.json`. All routes are mounted under `/api/v1` (`router.py` chain: `app/main.py` → `api/router.py` (`/api`) → `api/v1/router.py` (`/v1`) → feature routers).

Mailpit dev UI (captured outgoing email): http://localhost:8025.

## Architecture

### Settings & config
`app/core/settings.py` — a single Pydantic `Settings` (cached via `settings = get_settings()`) reads **all** config from environment variables. There are no defaults for secrets/DB/SMTP, so the app fails to import without a complete env. `postgres_dsn` and `mail_config` are computed fields. Tests and `compose.dev.yml` document the full required env var set.

### Models & DB (note the SQLAlchemy / SQLModel split)
- Models in `app/models/user.py` use **SQLAlchemy 2.0** `DeclarativeBase` (`app/models/base.py`) with `Mapped[...]` / `mapped_column`. Alembic autogenerate targets `Base.metadata`.
- But `app/core/database.py` hands out **`sqlmodel.Session`** (`SessionDep`). So the ORM models are plain SQLAlchemy while the session type comes from SQLModel — keep new models on the SQLAlchemy `Base`, not `SQLModel`.
- Core tables: `User`, `Role`, `UserRole` (M2M), `RoleAccess` (permission strings attached to a role). UUID PKs, soft-delete via `is_active`, audit columns (`created_at`/`updated_at`/`updated_by`).
- `alembic/versions/` is currently empty — no migrations have been generated yet.

### Authentication (`app/auth/`)
- Password hashing: argon2 via passlib (`app/auth/security.py`). `verify_dummy_password` equalizes timing when a user doesn't exist.
- Tokens: **PyJWT**, HS256. `TokenPayload` carries `sub`/`exp`/`iat`/`jti`. The `jti` holds the user's `token` column — a **token version** string. Changing a user's password/email or forcing logout rotates `User.token`, instantly invalidating all existing JWTs (see `get_current_user`, which rejects when `user.token != data.jti`).
- Auth accepts either a `session_token` httponly cookie **or** a bearer token (`get_token` in `auth_dependencies.py`). `CurrentUser` is the dependency that resolves the user and loads their permission set.
- Account lockout (`account_lock.py`): failed attempts counted in Redis; after `TRYS_BEFORE_LOCK`, account is locked with exponential backoff (`get_locked_time`) and an unlock token is emailed.
- Registration is two-step and token-gated (`register.py`): `register/request` emails a token (stored in Redis), `register/complete` consumes it.

### Redis token store (`app/auth/token_store.py`, `app/core/redis.py`)
Generic bidirectional token↔subject store used for registration tokens, unlock tokens, and failed-login counters. `set_token_pair` keeps both `prefix:subject → token` and `token → subject` keys with a TTL so either direction can be looked up and old tokens get evicted on rotation.

### RBAC / permission catalog (`app/security/`)
Permissions are **declared in code**, stored in the DB as plain strings, and enforced as FastAPI dependencies:

- `SecurityControl` (`security_control.py`) wraps one permission string (e.g. `users:read`). Its `.requiere` property returns an `Annotated[bool, Depends(...)]` that raises 403 unless `CurrentUser` has the permission.
- `SecurityGroup` (`security_group.py`) is an `Enum` base; each member is `(access_string, description)` and exposes `.permission`, `.requiere`, `.check`.
- Concrete groups live in `app/security/groups/*.py` (`UserPermissions`, `RolePermissions`, `PermissionPermissions`) and are registered in `app/security/catalog.py` (`SECURITY_GROUPS`).
- Enforce on an endpoint by adding the dependency, e.g. `_: UserPermissions.READ.requiere`.
- A user's permission set is materialized at request time from `RoleAccess.access` joined through `UserRole` (`build_current_user`), and membership is checked via `UserBase.access_control`.

When adding a permission: add the enum member to the relevant group, ensure its group is in `SECURITY_GROUPS`, and update `tests/test_security_catalog.py` (which asserts the exact ordered list of permission strings and that they are unique).

### Schema conventions & the query engine (`app/schemas/`, `app/query/`)
Schemas follow a per-operation convention — a schema is a contract for **one operation/context**, never "the whole table". Technical base classes live in `app/schemas/base.py` (no business fields): root `ApiSchema`; `ApiReadSchema` (`from_attributes=True`) backs `XRead`/`XListItem`; `ApiWriteSchema` (`extra="forbid"`) backs `XCreate`/`XReplace`; `ApiPatchSchema` backs `XUpdate` (PATCH = all-Optional fields + consume with `model_dump(exclude_unset=True)`). The `XQuery` base is `query/schema.py::OffsetQuerySchema`. Naming per resource `X`: `XBase` (optional shared domain fields), `XCreate`, `XRead`, `XListItem`, `XUpdate`, `XReplace`, `XQuery`, `XDeleteResult`, `X<Action>Request/Result`. Note: `schemas/user.py::SessionUser` is the authenticated-session user (has `permissions` + `access_control`), **not** a generic read schema — don't confuse it with `UserRead`.

The `app/query/` engine turns a public read schema + ORM model + `QueryOptions` into a dynamic `XQuery` (FastAPI query-params model) plus filter/sort/pagination application. Security rule is **allowlist**: only fields listed in `QueryOptions` (`filter_fields`, `sort_fields`, `search_fields`, `in_fields`, `null_filter_fields`) become queryable — "lo no declarado permanece prohibido". Use `ResourceQuery(name, model, schema, options)` (built once at module load) + `paginate()`/`OffsetPage` (response contract in `schemas/pagination.py`). Config errors fail fast at import (`QuerySchemaConfigError`); bad client params raise `QueryParameterError` → 422 via `core/error_handlers.py` using the `schemas/error.py` envelope (`{code, message, errors}`). Full vision/roadmap: `~/.claude/plans/reporte-de-arquitectura-hashed-coral.md`.

### Routing status
`api/v1/router.py` only mounts the `auth` router today. `api/v1/users.py`, `roles.py`, and `permissions.py` exist but are **empty stubs**. `test_auth_routes.py` explicitly asserts that unimplemented routes (`/auth/refresh`, `/auth/logout`) are absent from the OpenAPI schema — keep that test in mind when adding/removing routes.

## Language
Code comments, docstrings, and user-facing API messages are written in **Spanish**. Match that when editing.
