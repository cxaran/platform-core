# AGENTS.md

High-signal guidance for OpenCode agents working in this repo. Read alongside
`CLAUDE.md` (detailed architecture) and the skills for API work:
`platform-api-conventions` (`.opencode/skills/platform-api-conventions/SKILL.md`)
for routing/RBAC/errors/migrations, and `platform-query-schemas`
(`.opencode/skills/platform-query-schemas/SKILL.md`) for the list/filter engine
(`app/query`) and Pydantic HTTP contracts (`app/schemas`).

## What is implemented

FastAPI `backend/` and the Next.js `frontend/` are implemented. `nginx/nginx.conf`
proxies `/api/` → backend and `/` → frontend.

## Run everything from the repo root, never from `backend/`

The top-level package is **`backend`** (its parent, the repo root, must be on
`PYTHONPATH`). Every import is `from backend.app... import ...`. Consequences:

- ASGI path is `backend.app.main:app`.
- Activate `backend/venv` or use `backend/venv/Scripts/python`.
- Running commands from `backend/` will break imports.

```powershell
uvicorn backend.app.main:app --reload
```

## Tests — stdlib unittest, run by module name

`backend/tests/` has **no `__init__.py`**, so `unittest discover` does not work.
List the modules explicitly. Run from repo root.

```powershell
# Backend canonical suite: prints total/passed/skipped/failed.
python -m backend.tests.canonical_suite

# Frontend canonical suite (inside frontend container or frontend/ workdir).
npm run check:canonical

# E2E Bootstrap (from frontend/ workdir; creates and destroys isolated Docker stack).
npm run test:e2e:bootstrap

# Single module / single test
python -m unittest backend.tests.test_security_catalog
python -m unittest backend.tests.test_security_catalog.SecurityCatalogTest.test_catalog_permissions_are_unique
```

Note: `test_query_postgres` needs a live Postgres (per CLAUDE.md). Other suites
are unit-style and do not require services.

Canonical reports should use:

```text
Backend canonical suite:
  total:
  passed:
  skipped:
  failed:

Frontend canonical suite:
  check:api:
  lint:
  typecheck:
  build:
```

## Type checking

Pyright is configured in `pyrightconfig.json` (`venvPath: backend`, `venv: venv`,
`extraPaths: ["."]`). There is no `lint`/`typecheck` npm script — run Pyright
directly if needed. No formatter/lint command is wired up in the repo.

## Environment is mandatory and has no defaults

`app/core/settings.py` reads **all** config from env vars (DB, Redis, SMTP,
secrets). The app **fails to import** without a complete env. Tests and
`compose.dev.yml` document the required var set. Compose reads env from
`${APP_ENV_FILE:-.env}` (the root `.env` currently exists but is empty).

## Migrations

`alembic.ini` lives in `backend/`; it points at `backend/alembic`. Run from repo
root:

```powershell
alembic -c backend/alembic.ini revision --autogenerate -m "message"
alembic -c backend/alembic.ini upgrade head
```

## Docker

```powershell
docker compose -f compose.dev.yml up --build                       # dev: postgres + mailpit + backend
docker compose -f compose.dev.yml --profile migrate up migrate     # run migrations in-container
docker compose up --build                                          # prod stack
```

Dev Mailpit UI (captured outgoing email): http://localhost:8025.

Bootstrap E2E uses `compose.e2e.yml`, Docker project `platform-core-e2e`, and
host URL `http://127.0.0.1:31080`. It creates a disposable Postgres database
named `platform_core_e2e_test`, runs Alembic, drives `/setup` through the browser,
and tears the stack down with volumes. Do not point E2E at the dev database or use
`BOOTSTRAP_ADMIN_*` as a shortcut.

Next dev stores build manifests in the named volume `frontend_next`. If a new
route is present inside the container but still 404s in development, first
rebuild/restart frontend; if it persists, recreate only `frontend_next`. Do not
delete `node_modules`, Postgres, Redis, or global volumes for this symptom.

## Architecture gotchas (verify against CLAUDE.md before changing)

- **SQLAlchemy models + SQLModel session.** Models use SQLAlchemy 2.0
  `DeclarativeBase` (`app/models/base.py`); `database.py` hands out
  `sqlmodel.Session`. Keep new ORM models on the SQLAlchemy `Base`, **not**
  `SQLModel`. Alembic autogenerate targets `Base.metadata`.
- **JWT `jti` is a token version, not a token id.** It holds `User.token`. Any
  password/email change or forced logout rotates `User.token`, invalidating all
  existing JWTs (enforced in `get_current_user`).
- **Initial-data seed is not product setup.** `BOOTSTRAP_ADMIN_*` settings and
  `backend.app.core.bootstrap` are an operational seed tool for development,
  tests, or explicit recovery. Do not run it automatically at container startup
  and do not expose it as HTTP setup. A future product setup flow must use a
  distinct `BOOTSTRAP_SETUP_TOKEN`, persistent setup state, concurrency control,
  and administrator protection.
- **Password reset is backend-ahead.** Routes exist and should keep generic
  responses, token rotation, unlock, expiry, and one-time token use. Do not add
  public UI or mark it release-ready until rate limiting by IP/origin and by
  normalized identity, safe logging, and mail delivery configuration are covered.
- **Permissions are declared in code**, stored as plain strings, enforced as
  FastAPI dependencies (`SecurityControl`/`SecurityGroup` in
  `app/security/`). Adding a permission → update the group enum, ensure it is
  in `app/security/catalog.py::SECURITY_GROUPS`, and **update
  `test_security_catalog.py`** (it asserts the exact ordered, unique list).
- **Query engine is allowlist-only.** Only fields in `QueryOptions`
  (`filter_fields`, `sort_fields`, `search_fields`, `in_fields`,
  `null_filter_fields`) become queryable. Bad params → 422 via
  `core/error_handlers.py` with the `schemas/error.py` envelope.
  `OffsetPage`/`OffsetPagination` are defined **once** in `app/schemas/pagination.py`
  and reimported by `app/query` — do not redefine them in the query package.
- **Routers are implemented and consume the query engine.** `api/v1/`:
  `auth`, `permissions` (catalog read), `roles` (CRUD + permissions), `users`
  (self-service `/me`), `users_admin` (admin CRUD + roles + revoke-sessions).
  `users` and `users_admin` share the `/users` prefix (self-service `/me` is
  included first). They build list endpoints with `ResourceQuery` + the
  `api/resource_actions.py` helpers. `test_auth_routes.py` asserts
  `/auth/refresh` and `/auth/logout` are **absent** from OpenAPI — keep it green.
- **List/query layer (Fase 2).** `ListQueryContract` (`app/query/contracts.py`)
  is the main list abstraction; `ResourceQuery` is its compatibility facade.
  Reusable route logic lives in `api/resource_actions.py` (general CRUD/relation/
  serialize/error helpers) — keep one-off logic out of routers.

## Conventions that differ from defaults

- User-facing API messages, comments, and docstrings are in **Spanish**.
- Schemas are per-operation contracts (`XCreate`/`XRead`/`XUpdate`/...), never
  "the whole table". Technical bases live in `app/schemas/base.py`. See the
  `platform-api-conventions` skill before writing new schemas/endpoints.
- All routes mount under `/api/v1` (`app/main.py` → `api/router.py` →
  `api/v1/router.py` → feature routers). API docs at `/api/docs`,
  `/api/redoc`, `/api/openapi.json`.

## Do not commit

Never commit secrets or the populated `.env`. Only commit when explicitly
asked.
