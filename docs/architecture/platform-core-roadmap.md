# Charter de Platform Core

Documento de **alcance, principios e invariantes** del core. No es un registro de
decisiones (eso vive en `decisions.md`) ni una guía de desarrollo (eso es
`docs/desarrollo/`): describe qué es Platform Core, qué no es, y las reglas que todo
producto derivado debe respetar.

## Alcance

Platform Core es una base administrativa reusable sobre FastAPI y Next.js. Su
responsabilidad es ofrecer autenticación, sesiones, RBAC, recursos administrativos
dirigidos por contrato, formularios, relaciones, acciones, auditoría, tareas en segundo
plano, respaldos, un copiloto de IA y la operación mínima production-ready — para que un
producto derivado solo añada sus recursos de dominio.

**Fuera del core**: los dominios de producto. No se implementan entidades ni flujos de
negocio (pacientes, doctores, consultas, cumplimiento, etc.); esos módulos los añade el
producto consumidor sobre esta base.

**Decisión vigente**: single installation / single organization. No se agregan
`tenant_id`, `organization_id` ni multitenancy hasta que un producto consumidor lo
requiera explícitamente y con una decisión nueva.

## Invariantes

Estas reglas son la razón de ser del core; romperlas es un bug, no una preferencia.

### Supervivencia administrativa
Siempre debe existir al menos un usuario activo con cobertura efectiva de **todos** los
permisos declarados, y el rol administrador fundacional debe permanecer activo con
cobertura completa. El backend valida transaccionalmente antes de cualquier operación que
pueda romperlo (desactivar/eliminar usuario o rol, sustituir roles o permisos, quitar
permisos al rol fundacional). El error estable es `admin_coverage_required` y **no revela**
quién era el último administrador efectivo.

### Bootstrap único
La instalación se completa una sola vez por el flujo público `bootstrap` (`GET
/bootstrap/status`, `GET /bootstrap/catalog`, `POST /bootstrap/initialize`), con estado en
la tabla singleton `platform_setup` y UI en `/setup`. Se **cierra permanentemente** al
completarse; no se reabre aunque después se borren usuarios. `BOOTSTRAP_SETUP_TOKEN`
autoriza el flujo (obligatorio en producción); nunca se acepta en body, ni se guarda, ni
se devuelve, ni se loguea. El seed operativo por `BOOTSTRAP_ADMIN_*` es solo para
desarrollo/recuperación, nunca HTTP ni arranque de contenedores.

### Administración por contrato
Cada recurso se declara una vez en `RESOURCE_REGISTRY` y se proyecta filtrado por los
permisos de la sesión. Las relaciones, options, acciones y detalle se **publican
explícitamente**: el frontend nunca infiere endpoints ni replica reglas de permisos. Ver
[contrato de recursos](../desarrollo/contrato-de-recursos.md).

### Motor de consultas allowlist
Solo lo declarado es filtrable/ordenable/buscable ("lo no declarado permanece
prohibido"). Los errores de configuración fallan al importar; los parámetros inválidos
del cliente devuelven 422 con envelope estable.

### Auditoría append-only
Las operaciones sensibles y los cambios de configuración se registran en `audit_events`
(append-only). **Nunca** se registran contraseñas, cookies, bearer tokens, setup token,
headers/bodies completos ni valores de configuración: los cambios de config guardan
**solo nombres de campo**.

### Invalidación de sesiones
Cambiar privilegios relevantes o rotar credenciales invalida las sesiones afectadas al
instante (la versión de token en el `jti` del JWT).

## Seguridad y operación

- HTTPS real (terminado por túnel/proxy externo) y cookies `Secure` en producción.
- CSRF **sin configuración** por fetch metadata (`Sec-Fetch-Site: cross-site` → 403); no
  hay lista de orígenes que mantener. La URL pública de la instalación es propiedad del
  administrador (`system_settings.app_base_url`, fijada por verificación de dominio).
- Secretos en reposo cifrados con una única clave maestra Fernet (`APP_ENCRYPTION_KEY`).
- Migraciones reproducibles desde una migración inicial única; drift de OpenAPI bloqueante
  en CI; suites canónicas (backend contra PostgreSQL real, frontend y gateway) como gate;
  health/readiness (`/api/health`, `/api/ready`); logs estructurados con redacción de
  secretos; respaldos y restauración documentados y probados.

## Copiloto de IA

Parte del alcance actual (ver [capa agéntica](capa-agentica.md)): tres autoridades
separadas (FastAPI = datos + RBAC; `model-gateway` = proveedor de IA sin ver datos; el
navegador = ejecución de tools con la identidad de la cookie). Las herramientas se derivan
del contrato de recursos y **toda escritura requiere aprobación explícita** del usuario.

## Exclusión de dominio

El core no implementa dominios de negocio ni verticales. Los productos consumidores
añaden esos módulos sobre esta base cuando tienen requisitos propios.
