# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) and developers when working with this repository.

## Repository layout

Monorepo with a Docker Compose stack: `nginx` (reverse proxy) → `frontend`, `backend`, `model-gateway`, plus `redis`, `postgres` and a `docs` (mkdocs) service.

- `backend/` — FastAPI application (auth, RBAC, query engine, resource contract, services, agent, Taskiq jobs, Alembic).
- `frontend/` — Next.js App Router; a generic UI driven entirely by the backend resource contract.
- `model-gateway/` — provider-neutral AI inference runtime (TypeScript). Not an agent: it relays, never executes tools.
- `nginx/nginx.conf` — routes `/api/` → backend:8000, `/model-gateway/` → gateway:8081 (WebSocket), `/docs/` → mkdocs, everything else → frontend:3000.
- `compose.yml` (prod) / `compose.dev.yml` (dev) — both read env from `${APP_ENV_FILE:-.env}`; dev injects an inline env set and adds Mailpit. Prod services are gated by `COMPOSE_PROFILES` (`db`, `taskiq`, `migrate`).

Platform principle: **single installation / single organization** (`docs/architecture/decisions.md`). No multitenancy; RBAC applies to the whole installation; editable config lives in the DB, env vars are deployment defaults.

## Critical convention: imports are absolute from `backend.`

Every module imports as `from backend.app... import ...`. The top-level package is **`backend`** (its parent, the repo root, must be on `PYTHONPATH`). Consequences:

- Always run commands **from the repo root** (`platform-core/`), not from `backend/`.
- The ASGI app path is `backend.app.main:app` (the `Dockerfile` copies source to `/app/backend/` with `PYTHONPATH=/app`, so this resolves both locally and in-container).

## Commands

Run everything from the repo root. Python deps live in `backend/venv` (activate it or use `backend/venv/Scripts/python`).

```powershell
# Run the API locally (needs Postgres + Redis reachable and env vars set)
uvicorn backend.app.main:app --reload

# Backend canonical suite (stdlib unittest; tests/ has no __init__.py, so do not use `discover`)
python -m backend.tests.canonical_suite
python -m unittest backend.tests.test_security_catalog          # single module
python -m unittest backend.tests.test_security_catalog.SecurityCatalogTest.test_catalog_permissions_are_unique  # single test
# Postgres-gated tests run only when TEST_POSTGRES_URL points at a *_test database.

# Frontend canonical suite (run inside frontend container or frontend/ workdir)
npm run check:canonical    # check:api + lint + typecheck + node:test suites + build

# Database migrations (Alembic config lives in backend/, points at backend/alembic)
alembic -c backend/alembic.ini revision --autogenerate -m "message"
alembic -c backend/alembic.ini upgrade head

# Full stack
docker compose -f compose.dev.yml up --build                    # dev: postgres + redis + mailpit + backend + frontend + gateway
docker compose -f compose.dev.yml --profile migrate up migrate  # run migrations in-container
docker compose -f compose.dev.yml --profile taskiq up taskiq-worker taskiq-scheduler  # background jobs
docker compose up --build                                       # prod stack (profiles from COMPOSE_PROFILES)
```

API docs: `/api/docs`, `/api/redoc`, `/api/openapi.json`. Routers chain: `app/main.py` → `api/router.py` (`/api`, mounts health + v1) → `api/v1/router.py` (`/v1`) → feature routers. Health lives at `/api/health` and `/api/ready` (NOT under `/v1`); everything else under `/api/v1`.

Mailpit dev UI (captured outgoing email): http://localhost:8025.

## Architecture

### Settings & config
`app/core/settings.py` — a single Pydantic `Settings` (cached via `settings = get_settings()`) reads **all** config from environment variables. There are no defaults for secrets/DB/Redis, so the app fails to import without a complete env. `postgres_dsn` and `mail_config` are computed fields. `compose.dev.yml` documents the full required env var set. `scripts/install.sh` generates a production `.env` with unique random secrets (never overwrites an existing one).

Editable runtime policy lives in the DB, not in env vars: the `system_settings` singleton (`app/models/system_settings.py` + `app/services/system_settings_service.py`) holds public registration (sole source of truth — the old `REGISTRATION_ALLOWED` env gate was removed), verified base domain, institution name, site description, application timezone, login-verification mode, Google login, password reset and the outgoing-mail transport (environment/SMTP/Resend, secrets Fernet-encrypted write-only). A derived setup checklist (`build_setup_checklist`) is served at `/system-settings/setup-checklist` and rendered as a dismissible banner on the dashboard.

Secrets at rest are encrypted with `app/services/secret_cipher.py`: `APP_ENCRYPTION_KEY` (Fernet) is the **single master key** (required in production; there is no legacy key chain). It encrypts SMTP/Resend secrets, Google Drive refresh token, the age identity and OAuth profiles.

Domain verification: `POST /system-settings/{id}/verify-domain` fetches `GET /domain-challenge/{nonce}` THROUGH the candidate domain and compares an HMAC of the nonce; on success the origin is persisted as `app_base_url` and used to build absolute URLs (email links, OAuth redirect URIs).

CSRF protection is config-free (`app/core/csrf.py` → `CrossSiteMutationGuardMiddleware`): cookie-authenticated mutations whose `Sec-Fetch-Site` header says `cross-site` get a 403 — no origin allowlist. The model-gateway WebSocket handshake applies the same fetch-metadata rule. The installation's public URL is admin-owned: `system_settings.app_base_url` (written only via bootstrap/verify-domain through `public_base_url_or_none`, which enforces HTTPS in production) — there is no env-var fallback for absolute URLs.

Config changes are audited via `app/services/config_audit.py` into the append-only `audit_events` table with FIELD NAMES ONLY (never values); `audit_events` is exposed as a read-only queryable resource under the dedicated `audit_events:read` permission.

### Models & DB (note the SQLAlchemy / SQLModel split)
- Models use **SQLAlchemy 2.0** `DeclarativeBase` (`app/models/base.py`) with `Mapped[...]` / `mapped_column`. Alembic autogenerate targets `Base.metadata`.
- But `app/core/database.py` hands out **`sqlmodel.Session`** (`SessionDep`). So the ORM models are plain SQLAlchemy while the session type comes from SQLModel — keep new models on the SQLAlchemy `Base`, not `SQLModel`.
- Core tables: `User`, `Role`, `UserRole` (M2M), `RoleAccess` (permission strings attached to a role). UUID PKs, soft-delete via `is_active`, audit columns (`created_at`/`updated_at`/`updated_by`). Platform tables: `platform_setup`, `system_settings` (singleton), `audit_events` (append-only), `backup_settings`/`backup_oauth_states`/`backup_runs`, `ai_provider_credentials`, notification/web-push tables.
- Enums persist as NON-native enums (`native_enum=False` → VARCHAR + CHECK; see `app/models/enums.py`). Size the VARCHAR to the longest value.
- Migrations live in `backend/alembic/versions/`: a **single consolidated initial migration** `47047ac47de1` (all tables + singleton seeds; also `CREATE EXTENSION unaccent` / `pg_trgm`) plus the incremental `c9d0e1f2a3b4` (site description). No compatibility with installations from before 2026-07-14 — everything recreates from the initial migration. The Taskiq broker table is NOT migrated (the broker creates it).

### Authentication (`app/auth/`)
- Password hashing: argon2 via passlib (`app/auth/security.py`). `verify_dummy_password` equalizes timing when a user doesn't exist.
- Tokens: **PyJWT**, HS256. `TokenPayload` carries `sub`/`exp`/`iat`/`jti`. The `jti` holds the user's `token` column — a **token version** string. Changing a user's password/email or forcing logout rotates `User.token`, instantly invalidating all existing JWTs (see `get_current_user`, which rejects when `user.token != data.jti`).
- Auth accepts either a `session_token` httponly cookie **or** a bearer token (`get_token` in `auth_dependencies.py`). `CurrentUser` resolves the user and loads their permission set. A sliding-session middleware renews the cookie.
- Account lockout (`account_lock.py`): failed attempts counted in Redis; after `TRYS_BEFORE_LOCK`, the account is locked with exponential backoff and an unlock token is emailed.
- Registration is two-step and token-gated (`register.py`): `register/request` emails a token (stored in Redis), `register/complete` consumes it. Optional second-step login verification (code/link by email) is a DB-editable policy; admins with full coverage are exempt.

### Redis token store (`app/auth/token_store.py`, `app/core/redis.py`)
Generic bidirectional token↔subject store for registration tokens, unlock tokens and failed-login counters. `set_token_pair` keeps both `prefix:subject → token` and `token → subject` keys with a TTL so either direction resolves and old tokens get evicted on rotation.

### RBAC / permission catalog (`app/security/`)
Permissions are **declared in code**, stored in the DB as plain strings, and enforced as FastAPI dependencies:

- `SecurityControl` (`security_control.py`) wraps one permission string (e.g. `users:read`). Its `.requiere` property returns an `Annotated[bool, Depends(...)]` that raises 403 unless `CurrentUser` has the permission.
- `SecurityGroup` (`security_group.py`) is an `Enum` base; each member is `(access_string, description)` and exposes `.permission`, `.requiere`, `.check`.
- Concrete groups live in `app/security/groups/*.py` and are registered in `app/security/catalog.py` (`SECURITY_GROUPS`).
- Enforce on an endpoint by adding the dependency, e.g. `_: UserPermissions.READ.requiere`.
- A user's permission set is materialized at request time from `RoleAccess.access` joined through `UserRole` (`build_current_user`); membership is checked via `UserBase.access_control`. **Administrative survival** prevents leaving the installation without an admin that has full permission coverage.

When adding a permission: add the enum member to the relevant group, ensure its group is in `SECURITY_GROUPS`, and update `tests/test_security_catalog.py` (which asserts the exact ordered list of permission strings and that they are unique).

### Schema conventions & the query engine (`app/schemas/`, `app/query/`)
Schemas follow a per-operation convention — a schema is a contract for **one operation/context**, never "the whole table". Technical base classes live in `app/schemas/base.py` (no business fields): root `ApiSchema`; `ApiReadSchema` (`from_attributes=True`) backs `XRead`/`XListItem`; `ApiWriteSchema` (`extra="forbid"`) backs `XCreate`/`XReplace`; `ApiPatchSchema` backs `XUpdate` (PATCH = all-Optional fields consumed with `model_dump(exclude_unset=True)`). The `XQuery` base is `query/schema.py::OffsetQuerySchema`. Note: `schemas/user.py::SessionUser` is the authenticated-session user (has `permissions` + `access_control`), **not** a generic read schema.

The `app/query/` engine turns a public read schema + ORM model + `QueryOptions` into a dynamic `XQuery` (FastAPI query-params model) plus filter/sort/pagination application. Security rule is **allowlist**: only fields declared in `QueryOptions` (`filter_fields`, `sort_fields`, `search_fields`, `in_fields`, `null_filter_fields`, and per-field `field_operators`) become queryable — "lo no declarado permanece prohibido". Config errors fail fast at import (`QuerySchemaConfigError`); bad client params raise `QueryParameterError` → 422 via `core/error_handlers.py` using the `schemas/error.py` envelope (`{code, message, errors}`). Validation items travel structured (`type` + `ctx`, raw `message`); the Spanish UX translation lives in the FRONTEND (`src/core/api/validation-messages.ts`).

- **Operators** (`query/operators.py`): `eq`, `ne`; text `contains`/`starts_with`/`ends_with` (escaped ILIKE); comparison `gt`/`gte`/`lt`/`lte`; sets `in`/`not_in`; calendar `on`/`before`/`after`/`between` (value `date`, resolved to day bounds in the application timezone, DST-safe — a runtime-editable policy). `between` is polymorphic: calendar semantics on `datetime`, direct inclusive comparison on numeric/`date`. ARRAY columns: `contains_any` (`&&`) / `contains_all` (`@>`). The declared operators surface in the capability contract; the frontend never infers parameter names or suffixes.
- **Search** (`query/search.py`): `SearchMode` selects the strategy — `ILIKE` (default, portable), `UNACCENT` (accent-insensitive, Postgres `unaccent`) or `TRIGRAM` (fuzzy, Postgres `pg_trgm`).
- **Counting** (`query/count_strategies.py`): `AutomaticCount` (default), `DistinctIdentityCount` (1:N joins) or `NoTotalCount` (large feeds: no `COUNT(*)`, `has_next` via over-fetch, `total` null; used by `audit_events`).
- **Facets & stats** (`query/facets.py`): value facets (Excel-style autofilter, excluding the column's own filter) and numeric aggregates over the active filter.
- **Engine layers:** `ListQueryContract` (`query/contracts.py`) binds model + output schema + compiled query schema + `CompiledQueryPlan`; config comes via `options` OR `policy` (both = config error). `ResourceQuery` is an **alias** of the same class. `QueryOptions.to_policy()` adapts options → `QueryPolicy`/`FieldSpec`; `compile_list_query[_from_policy]` returns `(schema, plan)`. The package docstring (`query/__init__.py`) has the architecture map.

### Resource contract & projection (`app/resources/`)
Each first-class resource is declared once in `RESOURCE_REGISTRY` (`resources/registry.py`): the `ResourceQuery`, per-operation schemas, per-operation permissions, actions (fixed body or input form, confirmation, `visible_when`/`enabled_when` state conditions), relational editors, related lists, detail, file upload/download. `resources/projection.py` projects each definition to a `ResourceCapability`, **filtered by the session's permissions** (unauthorized parts are omitted, never `allowed: false`). The frontend renders any resource from this contract with zero per-resource UI. Routers build list endpoints with `ResourceQuery` and the general route helpers in `api/resource_actions.py` (CRUD/relation/serialize/error helpers — keep one-off logic out of routers).

### Routing status
Routers mounted in `api/v1/router.py`: `auth`, `bootstrap`, `permissions` (catalog read), `roles` (CRUD + permissions), `users` (self-service `/me`) + `users_admin` (admin CRUD + roles + revoke-sessions, sharing the `/users` prefix), `system_settings`, `branding`, `audit_events`, `backups`, `notifications`, `resources` (capability catalog + facets/stats), `ai_providers`, `agent` (connection ticket), `agent_oauth` (provider OAuth) and `agent_internal` (server-to-server credential lease). `test_auth_routes.py` asserts `/auth/refresh` and `/auth/logout` are absent from the OpenAPI schema — keep it green when adding/removing routes.

### Background jobs & backups
- **Taskiq over PostgreSQL** (`app/taskiq_app.py`; see `docs/desarrollo/tareas-en-segundo-plano.md`). Worker and scheduler are opt-in Docker services (`--profile taskiq`); FastAPI only starts the broker in its lifespan to PUBLISH tasks, never to run them. Channel/table: `platform_core_taskiq*`. Tasks: `backups.tick`, `notifications.tick` (per minute), `maintenance.retention` (daily).
- **Encrypted backups to Google Drive** (`app/services/backup_service.py`; see `docs/operacion/respaldos.md`): `backups.tick` runs every minute and consults due work in PostgreSQL (`backup_settings.next_run_at`) — the real schedule/retention is DB-edited, not a cron. Pipeline: `pg_dump --snapshot` → `pg_restore --list` verify → tar → OPTIONAL `age` encryption → resumable idempotent Drive upload → local GFS retention. An EXPLORER artifact (readable SQLite from the same snapshot, sensitive columns excluded) can accompany each backup. Frontend: `/backups` (Drive files + settings) and `/backups/explore` (sql.js WASM + local age decryption in the browser). The Docker image installs `postgresql-client` and `age`.
- Kill switch: `BACKUPS_ENABLED` (env, emergency); the normal UI-editable switch is `backup_settings.enabled`.

### Agentic copilot (`app/agent/`, `model-gateway/`, `frontend/src/core/agent/`)
Three separated authorities, never mixed: FastAPI owns **data + RBAC** and the encrypted per-user provider credentials; `model-gateway` owns the **AI provider** (never sees business data, never executes tools); the **browser** executes every tool with the session cookie's identity. The browser gets a short-lived connection ticket (`POST /api/v1/agent/connection-ticket`, HS256 JWT `aud=agent-gateway`); per turn, the gateway leases the decrypted credential from `POST /api/v1/internal/agent/credential-lease` (server-to-server secret, internal-only). Copilot tools are **derived from the resource contract**; every write goes through an immutable canonical plan the user approves (the payload never reaches the gateway). See `docs/architecture/capa-agentica.md`.

### Observability
- `RequestLoggingMiddleware` (`app/core/request_logging.py`) logs `method`, `path`, `status_code`, `duration_ms`, `request_id` to stdout — never body, headers, query params or credentials. Propagates `X-Request-ID`.
- Health: `/api/health` (liveness) and `/api/ready` (readiness: DB + Redis, 503 on failure). `/metrics` (Prometheus) is mounted OUTSIDE `/api` so nginx never exposes it publicly.

## Language
Code comments, docstrings, and user-facing API messages are written in **Spanish**. Match that when editing. (`AGENTS.md` and `model-gateway/README.md` are the exceptions, in English.)
