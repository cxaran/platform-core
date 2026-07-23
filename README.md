# Platform Core

Base administrativa **reutilizable y auto-hospedada** para construir productos sobre FastAPI + Next.js. Resuelve, de una vez y bien, todo lo que un producto interno necesita antes de escribir su dominio —autenticación, roles y permisos, listados filtrables gobernados por contrato, configuración editable en runtime, auditoría, tareas en segundo plano, respaldos cifrados y un copiloto de IA— para que el producto derivado solo añada sus recursos.

Diseñada como **instalación única / organización única** (ver `docs/architecture/decisions.md`): no hay multitenancy, el RBAC aplica a toda la instalación y la configuración vive en la base de datos, editable y auditada desde la interfaz. Es la plataforma de la que deriva, por ejemplo, MedicoPilot.

## Qué incluye

**Identidad y seguridad**
- Login por cookie httponly **o** Bearer. El `jti` del JWT es una *versión de token*: cambiar contraseña/correo o revocar sesiones rota `User.token` e invalida todas las sesiones al instante.
- Registro en dos pasos por correo, recuperación de contraseña y desbloqueo de cuenta por token, con rate limiting en Redis (fail-closed en producción).
- **CSRF sin configuración** por *fetch metadata*: una mutación autenticada por cookie con `Sec-Fetch-Site: cross-site` recibe 403 — sin lista de orígenes que mantener. La misma regla protege el handshake WebSocket del gateway.
- **RBAC declarado en código**: los permisos son enums (`SecurityGroup`) agrupados en un catálogo único; se almacenan como strings y se exigen como dependencias de FastAPI. La *supervivencia administrativa* impide dejar la instalación sin un administrador con cobertura completa.
- Bitácora `audit_events` append-only, consultable como recurso bajo permiso dedicado. Los cambios de configuración se auditan con **solo nombres de campos, nunca valores**.
- Secretos en reposo cifrados con una **única clave maestra Fernet** (`APP_ENCRYPTION_KEY`, obligatoria en producción).

**Contrato de recursos (capability-driven)**
- Cada recurso se declara una vez en `RESOURCE_REGISTRY` (query, schemas por operación, permisos, acciones con confirmación/formulario y condiciones de estado, editores relacionales, listas relacionadas, detalle, subida/descarga de archivos) y se proyecta a `GET /api/v1/resources` **filtrado por los permisos de la sesión** (lo no autorizado se omite, nunca `allowed: false`).
- Motor de query **allowlist-only**: solo lo declarado es filtrable/ordenable/buscable ("lo no declarado permanece prohibido"). Operadores por campo: igualdad y negación, texto (`contains`/`starts_with`/`ends_with`), comparación (`gt`/`gte`/`lt`/`lte`), conjuntos (`in`/`not_in`), fecha de calendario DST-safe (`on`/`before`/`after`/`between` en la zona de la app), `between` numérico, columnas ARRAY (`contains_any`/`contains_all`) y facetas estilo hoja de cálculo. Búsqueda global `ILIKE`, insensible a acentos (`unaccent`) o difusa (`pg_trgm`), a elección del recurso. Orden estable con desempate interno por PK; paginación offset con conteo o modo sin total para feeds grandes.
- El frontend es 100 % genérico: tipos generados del OpenAPI (jamás interfaces a mano), tabla con filtros estilo hoja de cálculo, chips, búsqueda, columnas persistentes, vistas guardadas, atajos de teclado, modo tarjetas, exportación Excel/PDF con vista previa en vivo, vista de detalle, formularios de alta/edición y editor relacional con pestañas. Tema claro/oscuro sin parpadeo.

**Operación**
- **Configuración del sistema en la base de datos** (singleton editable y auditado): registro público con candado de despliegue, dominio base verificado por reto HMAC (fija la URL pública de la instalación, usada para construir enlaces absolutos y URLs de OAuth), nombre institucional, descripción del sitio, correo saliente configurable (entorno/SMTP/Resend, secretos cifrados write-only, correo de prueba), verificación de inicio de sesión y login con Google. Un checklist de puesta en marcha **derivado del estado real** guía al administrador desde el dashboard.
- Asistente de instalación (`/setup`) protegido por token: administrador inicial, roles adicionales con permisos y política inicial de la plataforma.
- **Tareas en segundo plano con Taskiq sobre PostgreSQL** (sin Redis/Celery): worker y scheduler son servicios Docker opt-in, nunca hijos de FastAPI.
- **Respaldos a Google Drive**: `pg_dump` con snapshot verificado, cifrado `age` opcional, subida resumible e idempotente, retención GFS, artefacto de exploración (SQLite legible) y visor en el navegador (`/backups`) con descifrado local — la clave privada nunca sale del dispositivo.
- Notificaciones persistentes por usuario: campana in-app + correo + Web Push (VAPID).

**Copiloto de IA**
- Cada usuario aporta su propia credencial de proveedor (API key o cuenta ChatGPT por OAuth), cifrada en reposo. El copiloto deriva sus herramientas del contrato de recursos que el rol del usuario puede ver, y **toda escritura requiere aprobación explícita**. Tres autoridades separadas: FastAPI (datos + RBAC), `model-gateway` (proveedor de IA, sin ver datos del negocio) y el navegador (ejecuta las tools con la identidad de la cookie).

## Stack

FastAPI 0.138 (SQLAlchemy 2.0 + SQLModel `Session`, Alembic sobre PostgreSQL 16, Redis 7) · Next.js 16 / React 19 / Tailwind 4 · model-gateway (TypeScript, Node 24) · nginx · Docker Compose · Taskiq. Python 3.12.

## Instalación (producción self-hosted)

El servidor es **HTTP puro**; el HTTPS lo termina un túnel o proxy externo. El instalador genera un `.env` con secretos únicos y **nunca sobrescribe uno existente**.

```bash
git clone <repo> && cd platform-core
./scripts/install.sh                 # asistente interactivo: acceso, base de datos, secretos
# Levanta el stack, corre migraciones e imprime el token de Bootstrap y la URL /setup.
```

Abre `<tu-dominio>/setup` con el token que imprimió el instalador. Después del asistente, el checklist de la aplicación guía correo, dominio verificado y Google Drive — todo desde la interfaz, sin volver a editar archivos. Para actualizar: `./scripts/update.sh` (ver [actualización](docs/operacion/actualizacion.md)).

## Desarrollo

```bash
docker compose -f compose.dev.yml up --build                     # postgres + redis + mailpit + backend + frontend + gateway
docker compose -f compose.dev.yml --profile migrate up migrate   # migraciones
```

- Frontend: http://localhost:8080 (nginx dev) · API docs: `/api/docs` · Mailpit: http://localhost:8025
- Los comandos se ejecutan **desde la raíz del repo** (el paquete raíz es `backend`); convenciones y arquitectura detallada en `CLAUDE.md`.

### Pruebas

```bash
python -m backend.tests.canonical_suite   # suite backend (con TEST_POSTGRES_URL cubre también las de Postgres)
cd frontend && npm run check:canonical    # api + lint + typecheck + tests + build
```

## Estructura

```
backend/        FastAPI: auth, security (RBAC), query (motor allowlist), resources (contrato),
                services (config, correo, respaldos), agent (copiloto), jobs (Taskiq), alembic
frontend/       Next.js App Router: componentes genéricos dirigidos por el contrato de recursos
model-gateway/  Runtime de inferencia neutral de proveedor (TypeScript)
nginx/          Proxy: /api → backend, /model-gateway → gateway, /docs → mkdocs, resto → frontend
docs/           Operación, producto, desarrollo y arquitectura (ver docs/README.md)
scripts/        install.sh · update.sh · restore.sh
```

## Documentación

- `CLAUDE.md` — arquitectura detallada, convenciones y gotchas (guía para Claude Code y desarrolladores).
- `docs/` — guías por audiencia (operación, producto, desarrollo) y decisiones de arquitectura. Índice en `docs/README.md`.

Los comentarios, docstrings y mensajes de la API se escriben en **español**.
