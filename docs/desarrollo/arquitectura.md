# Arquitectura

Visión general para desarrollar sobre la plataforma. Las decisiones formales
viven en `docs/architecture/decisions.md` (material interno, fuera de este nav).

## Principio: administración por contrato

Cada recurso se declara **una sola vez** en el `RESOURCE_REGISTRY` del backend
(esquemas por operación, permisos, query allowlist, acciones, relaciones, detalle,
archivos) y se proyecta a `GET /api/v1/resources` **filtrado por los permisos de la
sesión**: lo no autorizado se omite, nunca se serializa `allowed: false`.

El frontend es un **motor genérico dirigido por contrato**: menú, tablas, filtros,
formularios, detalle, acciones y exportación se derivan del catálogo en runtime.
Añadir un recurso en el backend lo hace aparecer completo en la interfaz sin tocar
el frontend. Los tipos TypeScript se **generan del OpenAPI** (`npm run generate:api`;
`check:api` detecta drift). El detalle del ciclo backend → OpenAPI → frontend está en
[contrato de recursos](contrato-de-recursos.md).

Piezas clave:

- `backend/app/resources/registry.py` — la fuente única de recursos.
- `backend/app/resources/projection.py` — proyecta cada recurso a su capability
  filtrada por permisos.
- `backend/app/query/` — motor de query allowlist-only: solo lo declarado es
  filtrable/ordenable/buscable; el conjunto de operadores por campo es amplio
  (igualdad/negación, texto, comparación, conjuntos `in`/`not_in`, fecha de
  calendario DST-safe, `between` numérico, columnas ARRAY) y la búsqueda global
  admite `ILIKE`, sin acentos o difusa.
- `backend/app/security/` — RBAC declarado en código (`SecurityGroup`), exigido
  como dependencias de FastAPI; permisos como strings en la base.
- `frontend/src/core/resources/` — consumo del contrato con builders validados.

## Copiloto de IA

Tres autoridades separadas, nunca mezcladas:

| Autoridad | Responsable | Nunca hace |
| --- | --- | --- |
| Datos + RBAC | FastAPI | No almacena credenciales del proveedor en claro |
| Proveedor de IA | `model-gateway/` | No ve datos del negocio; no ejecuta tools |
| Ejecución de tools | Navegador del usuario | No tiene identidad propia (usa la cookie) |

Las herramientas del copiloto se **derivan del contrato de recursos**: cuando el
backend añade un recurso, el copiloto lo ve sin tocar código. Toda escritura pasa por
un plan canónico inmutable que el usuario aprueba (el payload nunca viaja al gateway).
Diseño completo: [capa agéntica](../architecture/capa-agentica.md).

## Otras piezas

- **Configuración editable en runtime**: singleton `system_settings`; secretos
  cifrados con una única clave Fernet (`APP_ENCRYPTION_KEY`); auditoría append-only
  que registra solo nombres de campos, nunca valores.
- **Notificaciones**: campana in-app + correo + Web Push (VAPID), persistentes por
  usuario.
- **Tareas en segundo plano**: Taskiq sobre PostgreSQL — ver
  [tareas en segundo plano](tareas-en-segundo-plano.md).
- **Respaldos**: cifrados a Google Drive — ver
  [respaldos](../operacion/respaldos.md).

## Convenciones

- Imports absolutos desde `backend.` (el paquete raíz es `backend`; los comandos
  corren desde la raíz del repo).
- Modelos ORM sobre SQLAlchemy 2.0 `Base`; la sesión es `sqlmodel.Session`
  (`SessionDep`). Enums no-nativos (VARCHAR + CHECK).
- Comentarios, docstrings y mensajes de API en **español**.
- Suites canónicas: `python -m backend.tests.canonical_suite` y
  `npm run check:canonical` (frontend); el gateway usa Vitest.
