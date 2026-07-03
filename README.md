# Platform Core

Base administrativa **reutilizable y auto-hospedada** para construir productos sobre FastAPI + Next.js. Resuelve, de una vez y bien, todo lo que cualquier producto interno necesita antes de escribir su dominio: autenticación, roles y permisos, listados filtrables gobernados por contrato, configuración editable en runtime, auditoría, tareas en segundo plano y respaldos cifrados — para que el producto derivado solo añada sus recursos.

Diseñada como **instalación única / organización única** (ver `docs/architecture/decisions.md`). Es la plataforma de la que deriva, por ejemplo, MedicoPilot.

## Qué incluye

**Identidad y seguridad**
- Login por cookie httponly o Bearer; el `jti` del JWT es una *versión de token*: cambiar contraseña/correo o revocar sesiones invalida todas las sesiones al instante.
- Registro en dos pasos por correo, recuperación de contraseña y desbloqueo de cuenta por token, con rate limiting en Redis (HMAC, fail-closed en producción) y protección CSRF por Origin/Referer.
- **RBAC declarado en código**: los permisos son enums (`SecurityGroup`) agrupados en un catálogo único; se almacenan como strings y se exigen como dependencias de FastAPI. La *supervivencia administrativa* impide dejar la instalación sin un administrador con cobertura completa.
- Bitácora `audit_events` append-only, consultable como recurso bajo permiso dedicado. Los cambios de configuración se auditan con **solo nombres de campos, nunca valores**.

**Contrato de recursos (capability-driven)**
- Cada recurso se declara una vez en `RESOURCE_REGISTRY` (query, schemas por operación, permisos, acciones con confirmación/formulario y condiciones de estado, editores relacionales, listas relacionadas, detalle, subida/descarga de archivos) y se proyecta a `/api/v1/resources` **filtrado por los permisos de la sesión**.
- Motor de query **allowlist-only**: solo lo declarado es filtrable/ordenable/buscable ("lo no declarado permanece prohibido"). Operadores de texto y de fecha de calendario (DST-safe), orden estable con desempate interno por PK y paginación offset.
- El frontend es 100 % genérico: tipos generados del OpenAPI (jamás interfaces a mano), tabla con filtros estilo hoja de cálculo, chips, búsqueda, columnas persistentes, vistas guardadas, atajos de teclado, modo tarjetas, exportación Excel/PDF con vista previa en vivo, vista de detalle, formularios de alta/edición y editor relacional con pestañas. Tema claro/oscuro sin parpadeo.

**Operación**
- **Configuración del sistema en la base de datos** (singleton editable y auditado): registro público con candado de despliegue, dominio base verificado por reto HMAC (se suma a los orígenes confiables en runtime), nombre institucional y correo saliente configurable (entorno/SMTP/Resend, secretos cifrados write-only, correo de prueba). Un checklist de puesta en marcha **derivado del estado real** guía al administrador desde el dashboard.
- Asistente de instalación (`/setup`) protegido por token: administrador inicial, roles adicionales con permisos y política inicial de la plataforma.
- **Tareas en segundo plano con Taskiq sobre PostgreSQL** (sin Redis/Celery): worker y scheduler son servicios Docker opt-in, nunca hijos de FastAPI.
- **Respaldos a Google Drive**: `pg_dump` con snapshot verificado, cifrado `age` opcional, subida resumible e idempotente, retención GFS, artefacto de exploración (SQLite legible) y visor en el navegador (`/backups`) con descifrado local — la clave privada nunca sale del dispositivo.
- Secretos en reposo cifrados con una **clave maestra Fernet** (`APP_ENCRYPTION_KEY`) con cadena de descifrado legada y re-cifrado perezoso.

## Stack

FastAPI (SQLAlchemy 2.0 + Alembic sobre PostgreSQL, Redis) · Next.js 16 / React 19 / Tailwind 4 · nginx · Docker Compose · Taskiq.

## Instalación (producción self-hosted)

```bash
./scripts/install.sh https://tu-dominio.com   # genera el .env con secretos únicos
docker compose build
docker compose --profile migrate run --rm migrate
docker compose up -d
docker compose --profile taskiq up -d taskiq-worker taskiq-scheduler   # respaldos
# Abre https://tu-dominio.com/setup con el token que imprimió el instalador.
```

Después del asistente, el checklist de la aplicación guía la configuración de correo, dominio verificado y Google Drive — todo desde la interfaz, sin volver a editar archivos.

## Desarrollo

```bash
docker compose -f compose.dev.yml up --build                     # postgres + redis + mailpit + backend + frontend
docker compose -f compose.dev.yml --profile migrate up migrate   # migraciones
```

- Frontend: http://localhost:3000 · API docs: `/api/docs` · Mailpit: http://localhost:8025
- Los comandos se ejecutan **desde la raíz del repo** (el paquete raíz es `backend`); detalles y convenciones en `CLAUDE.md` / `AGENTS.md`.

### Pruebas

```bash
python -m backend.tests.canonical_suite   # suite backend (con TEST_POSTGRES_URL cubre también las de Postgres)
cd frontend && npm run check:canonical    # api + lint + typecheck + tests + build
cd frontend && npm run test:e2e:bootstrap # E2E: stack Docker aislado + Playwright
```

## Estructura

```
backend/    FastAPI: auth, security (RBAC), query (motor allowlist), resources (contrato),
            services (config, correo, respaldos), jobs (Taskiq), alembic
frontend/   Next.js App Router: componentes genéricos dirigidos por el contrato de recursos
nginx/      Proxy: /api → backend, resto → frontend
docs/       Decisiones de arquitectura, Taskiq y respaldos
scripts/    install.sh (instalador de producción)
```

## Documentación

- `CLAUDE.md` / `AGENTS.md` — arquitectura detallada, convenciones y gotchas.
- `docs/architecture/` — decisiones y roadmap de la plataforma.
- `docs/background-tasks-taskiq.md` y `docs/backups-google-drive.md` — diseño de los verticales operativos.
- `backend/docs/phase-2-query-policy-design.md` — diseño del motor de query (Fase 2).

Los comentarios, docstrings y mensajes de la API se escriben en **español**.
