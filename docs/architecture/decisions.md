# Architecture Decisions

## 2026-06-26 - Single Installation / Single Organization

Decision: Platform Core opera como single installation / single organization.

Consecuencias:

- no se agregan `tenant_id`, `organization_id` ni scopes multitenant;
- RBAC aplica a la instalacion completa;
- multitenancy solo se introduce si un producto consumidor lo requiere
  explicitamente y con una decision nueva.

## 2026-06-26 - Bootstrap De Producto Vs Seed CLI

Decision: Bootstrap HTTP de producto y seed CLI operativo son mecanismos
separados.

Bootstrap HTTP:

- usa `/api/v1/bootstrap/*`;
- usa `BOOTSTRAP_SETUP_TOKEN` / `X-Bootstrap-Token`;
- persiste estado en `platform_setup`;
- es transaccional;
- se cierra permanentemente.

Seed CLI:

- usa `BOOTSTRAP_ADMIN_*`;
- sirve para desarrollo, tests o recuperacion controlada;
- no se ejecuta automaticamente;
- no se expone por HTTP;
- debe reconciliar `platform_setup` si crea usuarios en una instalacion pending.

## 2026-06-26 - System Administrator Role

Decision: Bootstrap crea un rol administrador fundacional y lo referencia por
`platform_setup.system_admin_role_id`.

Consecuencias:

- el rol fundacional contiene todos los permisos declarados actuales;
- el usuario inicial siempre recibe ese rol;
- el request no puede reducir sus permisos;
- el rol no depende de un nombre fijo editable;
- no puede desactivarse, eliminarse ni quedar sin cobertura completa;
- roles adicionales pueden crearse con subconjuntos de permisos.

## 2026-06-26 - Politica De Permisos Nuevos

Decision: roles personalizados no reciben permisos nuevos automaticamente. El
rol administrador fundacional recibe permisos nuevos mediante migracion de datos
controlada.

Cada permiso nuevo debe definir:

- access;
- label;
- description;
- group;
- version/introduction.

Cada commit que agregue permisos debe incluir:

- actualizacion del catalogo;
- migracion para el rol `system_admin_role_id` cuando corresponda;
- pruebas;
- revision de capabilities/OpenAPI si aplica.

No se hace auto-sync silencioso al iniciar la aplicacion.

## 2026-06-26 - Invalidacion De Sesiones

Decision: cambios de identidad o privilegios invalidan sesiones afectadas desde
servicios backend.

Debe invalidarse `User.token` cuando cambian:

- password;
- email;
- desactivacion/eliminacion de usuario;
- roles asignados al usuario;
- permisos de un rol asignado;
- desactivacion/eliminacion de rol;
- revocacion manual de sesiones.

El frontend no implementa invalidacion de privilegios.

## 2026-06-26 - Auditoria Administrativa

Decision: la madurez del core requiere auditoria persistente append-only para
operaciones sensibles.

La auditoria no registra passwords, cookies, bearer tokens, setup token, headers
completos, bodies completos ni datos sensibles no allowlisted.

## 2026-06-26 - Entornos Dev/Test/Production

Decision: production exige configuracion segura explicita; dev/test permiten
atajos controlados.

Production:

- `BOOTSTRAP_SETUP_TOKEN` obligatorio;
- `TRUSTED_BROWSER_ORIGINS` HTTPS obligatorio;
- cookies secure;
- sin admins automaticos;
- migraciones controladas.

Dev/test:

- `BOOTSTRAP_SETUP_TOKEN` opcional;
- si esta definido, se exige;
- bases E2E aisladas y descartables;
- seed CLI permitido solo como herramienta operativa.

## 2026-06-26 - Migraciones

Decision: PostgreSQL es la garantia fuerte. Todo cambio de schema usa Alembic.

Las migraciones deben funcionar desde cero y sobre instalaciones previas. Una
instalacion legacy con usuarios pero sin `platform_setup` se marca completed y
no reabre Bootstrap publico.

## 2026-06-26 - Estrategia E2E

Decision: el flujo minimo E2E es obligatorio para declarar completo el Bootstrap.

Flujo minimo:

```text
base limpia -> /setup -> crear administrador -> /login -> login -> dashboard
```

La base debe ser aislada y descartable. No se reutiliza la base local del
desarrollador y no se versionan credenciales productivas.

Comando versionado:

```powershell
cd frontend
npm run test:e2e:bootstrap
```

Estrategia actual:

- `compose.e2e.yml` usa el proyecto Docker `platform-core-e2e`;
- Postgres usa la base `platform_core_e2e_test` sobre almacenamiento temporal;
- Redis tambien es temporal;
- Alembic corre antes del navegador;
- nginx expone la aplicacion integrada en `http://127.0.0.1:31080`;
- `TRUSTED_BROWSER_ORIGINS` incluye ese origen;
- el flujo usa Bootstrap HTTP, nunca `BOOTSTRAP_ADMIN_*`;
- el runner ejecuta teardown con `docker compose down -v --remove-orphans`.

## 2026-06-26 - Suite Canonica Backend

Decision: todo modulo nuevo de pruebas backend debe agregarse a
`backend.tests.canonical_suite`, salvo justificacion explicita de exclusion.

El reporte canonico debe conservar:

```text
Backend canonical suite:
  total:
  passed:
  skipped:
  failed:
```

## 2026-07-14 - E2E retirado temporalmente

Decisión: se retira por ahora el E2E de Bootstrap (Playwright + stack Docker
aislado) del repositorio: `compose.e2e.yml`, `frontend/e2e/`,
`frontend/playwright.config.ts`, `frontend/scripts/run-e2e-bootstrap.mjs`, el
script `test:e2e:bootstrap` y la dependencia `@playwright/test`.

La estrategia E2E del 2026-06-26 sigue siendo válida como diseño; cuando se
reincorpore, recuperar los archivos desde el historial de git (último commit
que los contiene) y volver a declararlos en `README.md` y `CLAUDE.md`.

## 2026-07-14 - CSRF por Fetch Metadata (sin allowlist de orígenes)

Decisión: la plataforma se sirve siempre same-site detrás de nginx (nunca como
API para otros orígenes), así que la protección CSRF se simplifica a un guard
sin configuración basado en `Sec-Fetch-Site`.

Regla: una mutación (POST/PUT/PATCH/DELETE) con cookie `session_token` cuyo
`Sec-Fetch-Site` sea `cross-site` se rechaza con 403 (`csrf_origin_invalid`).
Todo lo demás pasa: métodos seguros, solicitudes sin cookie y solicitudes sin
el header (clientes no-navegador; los navegadores antiguos quedan cubiertos por
`SameSite=Lax` en la cookie). Defensa en profundidad: SameSite en el navegador,
el guard en el servidor.

Se retiró: la allowlist de orígenes del guard anterior, `runtime_origins.py`
(set en memoria + recarga multi-worker desde la base) y el efecto de
bootstrap/verify-domain de añadir orígenes a esa allowlist. Consecuencias:

- `TRUSTED_BROWSER_ORIGINS` deja de ser configuración de seguridad; queda solo
  como origen de RESPALDO para URLs absolutas (correos, OAuth) mientras
  `app_base_url` no esté declarado. Sigue exigiendo HTTPS en producción.
- `verify-domain` (reto HMAC) se conserva: persiste `app_base_url`, alimenta el
  checklist y los redirect URIs derivados.
- `normalize_base_url` vive ahora en `app/utils/base_url.py`.
- Un `TRUSTED_BROWSER_ORIGINS` mal escrito ya no puede bloquear las mutaciones
  de una instalación (la clase de incidente que motivaba la recarga runtime).

## 2026-07-14 - Traducción de errores de validación en el frontend

Decisión: la traducción UX (español) de los errores de validación estándar de
Pydantic sale del backend y pasa al frontend como utilidad global aplicada en
todas las llamadas.

Contrato: cada item de `errors` en el envelope (`schemas/error.py::ErrorItem`)
expone el error estructurado — `type` (p. ej. `string_too_short`) y `ctx` (las
constraints declaradas, solo valores primitivos) — con `message` crudo. El
frontend construye el mensaje visible en
`src/core/api/validation-messages.ts`, aplicado en `normalizeApiError` (el
embudo único de `requestJson`, que usan browser-client y server-client).

Reparto de responsabilidades:

- mensajes de NEGOCIO (validadores de dominio, `QueryParameterError`,
  `api_error`) siguen redactándose en español en el backend y viajan sin
  `type`: el frontend los muestra tal cual;
- los tipos estándar de Pydantic (`missing`, `string_too_short`, `ge/le/gt/lt`,
  email) se traducen en el frontend; tipos desconocidos caen a un mensaje
  general seguro (no se filtra texto interno en inglés);
- las suites de la capa API del frontend corren en `npm run test:api`
  (incorporado a `check:canonical` y al CI; antes esos tests existían pero no
  estaban cableados a ningún script).

## 2026-07-14 - Sin distinción de sesión cliente/staff

Decisión: Platform Core no tiene "clientes" — es una plataforma de
administración. Se elimina la distinción de duración de sesión por tipo de
usuario (cliente sin roles = sesión larga en días; staff con roles = sesión
corta en minutos).

Toda sesión dura `ACCESS_TOKEN_EXPIRE_MINUTES` y se extiende con la renovación
deslizante mientras haya actividad; rotar `User.token` sigue invalidando todas
las sesiones al instante.

Se retiró:

- `customer_session_expire_days` de Settings (env);
- `session_ttl_for_user` de `auth/auth.py` (y el TTL por usuario en login,
  verificación por correo y Google login);
- las columnas `customer_session_days` y `staff_session_minutes` de
  `system_settings` con sus CHECK (migración `a9c1d2e3f4b5`), sus campos en el
  bootstrap y en la UI de configuración, y los `_effective` derivados.

Un fork de producto que sí distinga tipos de sesión (p. ej. clientes de un
restaurante) reintroduce el concepto con su propia migración y política.

## 2026-07-14 - La URL pública es solo app_base_url (se retira TRUSTED_BROWSER_ORIGINS)

Decisión: la URL pública de la instalación tiene una sola fuente —
`system_settings.app_base_url`, declarada por el administrador (bootstrap o
Configuración) y verificable por reto HMAC. Se retira el env var
`TRUSTED_BROWSER_ORIGINS` / `settings.trusted_origins` (supersede el punto de
la decisión CSRF anterior que lo conservaba como respaldo).

Consecuencias:

- `installation_base_url` devuelve `app_base_url` o `None` (los correos ya
  degradan a token en texto sin enlace); `oauth_base_url` y
  `verification_base_url` caen solo al header Origin (desarrollo).
- La garantía HTTPS-en-producción se movió a la ESCRITURA de `app_base_url`:
  `system_settings_service.public_base_url_or_none` es la única puerta
  (bootstrap y verify-domain) y rechaza `http://` cuando
  `ENVIRONMENT=production`.
- `install.sh` ya no escribe la variable y se retiró el modo `--resume` (su
  única razón era releer el dominio del env).
- El model-gateway aplica la MISMA metodología que FastAPI: se retiró
  `GATEWAY_ALLOWED_ORIGINS` y el handshake WebSocket rechaza (1008) los que el
  navegador declara `Sec-Fetch-Site: cross-site`; sin header se deja pasar (la
  autenticación real es la sesión del gateway + ticket firmado).

## 2026-07-14 - Limpieza de código huérfano y analítica GA4 completada

Decisión: se elimina el código sin referencias detectado en auditoría, y la
rebanada de analítica del sitio (GA4) — que estaba cableada a medias
(configurable desde la UI pero sin endpoint público ni carga en el cliente) —
se COMPLETA en lugar de retirarse: el frontend tendrá sitio público.

Huérfanos retirados: `LOCAL_DOMAINS` (auth), `LoginChallenge` y `MODE_DISABLED`
(login_verification), `UserUpdate` (schemas/user), `WILDCARD_ACCESS`
(security_control — prometía comodines que `access_control()` no implementa),
`lock_for_update`/`lock_active_or_404` (resource_actions, sin llamadores) y los
aliases `ApiError`/`ValidationErrorDetail` (schemas/error).

Analítica GA4, ahora con las tres piezas:

1. Configuración en `system_settings` (4 columnas; el ID de medición es público
   por diseño de Google, no hay secretos). El PATCH exige el ID antes de
   encender (`analytics_requires_measurement_id`).
2. `GET /public/site/analytics` (sin auth, cache 60s): apagada devuelve solo
   `enabled: false` sin filtrar el ID.
3. Frontend: `AnalyticsLoader` montado SOLO en el layout del grupo `(public)`
   (el panel jamás se mide); con `require_consent` (default) no se carga
   `gtag.js` ni se envía evento alguno hasta que el visitante acepte (decisión
   recordada en localStorage, revocable); `debug_mode` marca eventos para
   DebugView. Si el despliegue añade CSP, debe permitir
   `googletagmanager.com`/`google-analytics.com`.

## 2026-07-14 - Los flujos de Google usan solo la URL declarada por el administrador

Decisión: el login con Google y los enlaces de verificación de login construyen
su base EXCLUSIVAMENTE desde `system_settings.app_base_url` (declarada por el
operador; HTTPS obligatorio en producción). Se elimina el fallback al header
`Origin` de la solicitud: un enlace que viaja por correo o un redirect_uri de
OAuth jamás debe derivarse de un header influenciable por el cliente.

- Sin URL declarada, `/auth/google/start` responde 404 (fail-fast: sin ella el
  flujo no puede funcionar — la consola de Google exige el URI exacto) y el
  enlace de verificación degrada al token/código en texto.
- Drive ya exigía el dominio; el login con Google acepta la URL declarada sin
  reto HMAC (misma columna: verificar no cambia el valor, solo lo certifica).
- En desarrollo se declara `http://localhost:8080` en el asistente o en
  Configuración; ya no hay base implícita por headers.

## 2026-07-14 - Migraciones consolidadas en una inicial única

Decisión: se recrea el historial de Alembic en UNA migración inicial
(`47047ac47de1_esquema_inicial`) autogenerada del metadata actual, con las
siembras que los servicios exigen: el singleton de `system_settings` (política
por defecto) y el de `backup_settings` (respaldos apagados, Drive
desconectado). Verificada contra Postgres 16 limpio: `alembic check` sin drift,
round-trip downgrade/upgrade, y la suite canónica completa con Postgres real
(463 passed).

Consecuencias:

- Las 15 migraciones incrementales previas desaparecen, incluidas sus
  reconciliaciones de instalaciones legacy (marcar `platform_setup` completed,
  importar flags del entorno, podas de permisos): una instalación NUEVA no las
  necesita.
- Instalaciones desplegadas ANTES de esta consolidación no tienen ruta de
  upgrade: se recrean desde cero (decisión aceptable en pre-release; a partir
  de aquí el historial vuelve a ser incremental).
- La política de permisos nuevos (migración de datos para el rol fundacional)
  sigue vigente para las migraciones FUTURAS.

## 2026-07-14 - Sin compatibilidad con instalaciones previas (baseline)

Decisión: el proyecto no mantiene compatibilidad con despliegues anteriores a
esta fecha — todo se recrea desde la migración inicial única. En consecuencia,
el código de transición se elimina y no se escribe nuevo:

- `BACKUP_TOKEN_ENCRYPTION_KEY` retirada: `APP_ENCRYPTION_KEY` es la ÚNICA
  clave Fernet (secret_cipher sin cadena de claves ni re-cifrado perezoso).
- `completion_origin='legacy'` se CONSERVA: no es compatibilidad — es el camino
  vivo del seed CLI (usuarios creados fuera del bootstrap en una instalación
  nueva reconcilian `platform_setup`).
- Regla hacia adelante: si una pieza existe solo para instalaciones viejas, se
  elimina en lugar de mantenerse.

## 2026-07-15 - Conexión de cuenta ChatGPT Plus/Codex (OAuth PKCE)

Decisión: se porta desde medicopilot la rebanada de suscripción ChatGPT
Plus/Codex. El gateway ya estaba en paridad (proveedor ``openai_codex`` contra
``chatgpt.com/backend-api/codex``, opt-in con ``GATEWAY_OPENAI_CODEX_ENABLED``);
se añaden el backend y el frontend que faltaban.

- Flujo OAuth browser-callback **PKCE** (no device-code): ``/users/me/ai-providers/
  oauth/openai/{start,complete,status}`` + DELETE. El ``code_verifier`` vive en
  memoria de proceso con TTL (``PkceStore``; con múltiples workers, mover a Redis).
- El perfil ``{access, refresh, expires, account_id}`` se guarda CIFRADO
  (``secret_cipher``) como credencial ``provider=openai`` /
  ``credential_type=oauth``; nunca se devuelve en claro ni se loguea.
- El arriendo interno distingue tipos: para ``oauth`` refresca el access token
  si está por vencer (skew configurable), persiste el perfil renovado y acota el
  arriendo al menor de (TTL, vencimiento del token). El 501 anterior desaparece.
- Configuración del operador: ``OPENAI_OAUTH_CLIENT_ID`` (obligatoria para
  habilitar; sin ella los endpoints responden 503). ``OPENAI_OAUTH_REDIRECT_URI``
  es opcional: se deriva de la URL declarada de la instalación
  (``app_base_url`` + ``/account/oauth/callback``).
- Frontend: bloque "Cuenta ChatGPT (suscripción)" en Mi cuenta → Proveedores de
  IA (conectar/estado/desconectar) y página de callback que completa el canje.
- Advertencia consciente: el flujo replica el patrón del cliente Codex de
  OpenAI, no un OAuth público documentado; el ``client_id`` lo aporta el
  operador, que asume esa decisión. Sin migración: el esquema ya contemplaba
  ``credential_type``.

## 2026-07-15 - Ampliación del vocabulario de operadores del motor de consultas

Decision: se añaden ocho capacidades de filtrado/búsqueda al motor allowlist
(`backend/app/query/`), manteniendo la regla "lo no declarado permanece
prohibido". Todo lo nuevo se declara por campo vía `field_operators` (o
selectores en `QueryOptions`), sin conjuntos paralelos en plan/policies salvo lo
imprescindible.

Operadores/estrategias nuevos:

- `gt` / `lt`: comparación estricta directa (numérico/fecha), simétrica a
  `gte`/`lte`. Vía `extended_filters`.
- `not_in`: complemento de `in` (lista, `NOT IN`). Vía `extended_filters`, no un
  conjunto paralelo; se declara por campo.
- `between` polimórfico: en `datetime` sigue siendo rango de día de calendario
  (dos parámetros `date`, zona de la app); en numérico/`date` compara los
  extremos directamente (parámetros del tipo del campo, ambos inclusivos). El
  descriptor lleva `calendar: bool` para distinguirlos; el front usa el widget
  `numberrange` para el numérico y `daterange` para el de calendario.
- `contains_any` / `contains_all`: operadores de columna ARRAY (Postgres `&&` y
  `@>`). Requieren un campo `list[X]`; el tipo se resuelve como `_ArrayType` y
  SOLO admite operadores de array (nunca eq/rango/in/búsqueda/sort). Sin
  consumidor en core aún (ningún list schema expone un array filtrable):
  capacidad del motor lista para forks, cubierta con test Postgres.
- Búsqueda `UNACCENT` (insensible a acentos) y `TRIGRAM` (difusa, `pg_trgm`):
  nuevas `SearchStrategy` elegidas con `QueryOptions.search_mode`. Solo Postgres;
  el default `ILIKE` sigue siendo portable (SQLite). Las extensiones `unaccent`
  y `pg_trgm` se crean en la migración inicial (extensiones "trusted", sin
  superusuario).
- `NoTotalCount`: modo de paginación sin `COUNT(*)` por página (feeds grandes).
  El executor sobre-lee (`limit+1`) para `has_next` y deja `total` en `None`;
  `OffsetPagination.total` pasa a `Optional[int]`. El front pagina prev/next sin
  número de páginas cuando `total` es null.
- Fechas relativas ("Hoy", "Últimos 7/30 días", "Este mes/año"): NO son un
  operador de backend, sino presets del frontend que componen el `between` de
  calendario usando el `calendar_timezone` publicado. El backend sigue recibiendo
  fechas civiles.

Consumidores en core:

- `backup_runs`: `file_size_bytes` y `attempt_count` obtienen `gt`/`lt`/`between`
  numérico; `status` obtiene `not_in` (diagnóstico por exclusión).
- `audit_events`: usa `NoTotalCount` (bitácora append-only que crece sin límite);
  su tabla pierde el "N de M" a cambio de no contar toda la bitácora por página.

Consecuencias de contrato: `FilterOperator` gana `gt/lt/not_in/contains_any/
contains_all`; `WidgetType` gana `numberrange`; `OffsetPagination.total` es
opcional. Tipos OpenAPI regenerados. Un campo con solo operadores extendidos
(p. ej. un array) se emite como filtrable aunque no sea columna visible ni filtro
`eq`, siempre que tenga label.
