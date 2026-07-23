# Contrato de recursos

El corazón de la plataforma: un recurso se **declara una vez en el backend** y el
frontend lo renderiza completo (tabla, filtros, formularios, detalle, acciones)
**sin código por recurso**. El copiloto de IA también deriva sus herramientas de este
mismo contrato. Añadir un recurso de dominio es declarar, no construir UI.

## El ciclo: declaración → proyección → OpenAPI → frontend

```
RESOURCE_REGISTRY            projection.py                 GET /api/v1/resources
(registry.py)        ─────►  filtra por permisos   ─────►  ResourceCapability[]
  ResourceDefinition          de la sesión                  (solo lo autorizado)
                                                                   │
                                                                   ▼
                                          frontend genérico (tipos del OpenAPI)
                                          tabla · filtros · formularios · acciones
```

- **`resources/registry.py`** — la fuente única. Cada `ResourceDefinition` reúne:
  el `ResourceQuery` (motor de query), los schemas por operación, los permisos por
  operación, las acciones (cuerpo fijo o formulario, confirmación, condiciones de
  estado `visible_when`/`enabled_when`), los editores relacionales, las listas
  relacionadas, el detalle y la subida/descarga de archivos.
- **`resources/projection.py`** — proyecta cada definición a un `ResourceCapability`
  **filtrado por los permisos de la sesión**: lo no autorizado simplemente no aparece,
  nunca se serializa `allowed: false`. Nunca viajan permisos, expresiones SQLAlchemy
  ni internals.
- **`schemas/capabilities.py`** — el contrato HTTP público (enums, no strings libres):
  tipos de valor, widgets, operadores filtrables, formas de valor, métodos.
- **Frontend** — `frontend/src/core/resources/` consume ese catálogo con builders
  validados. Los tipos TypeScript se **generan del OpenAPI** (`npm run generate:api`;
  `check:api` detecta drift). Jamás se escriben interfaces a mano.

## El motor de query (allowlist-only)

Regla de seguridad: **"lo no declarado permanece prohibido"**. Solo los campos y
operadores listados en `QueryOptions` de un recurso se vuelven consultables; el resto
no existe como parámetro y no se puede forjar. Los errores de configuración fallan al
importar (`QuerySchemaConfigError`); los parámetros inválidos del cliente devuelven 422.

`QueryOptions` declara, por campo:

- `filter_fields` — igualdad (`eq`), y rango por extremos (`gte`/`lte`) en tipos
  numéricos/fecha.
- `search_fields` — participan en la búsqueda global `q`. `search_mode` elige la
  estrategia: `ILIKE` (portable), `UNACCENT` (sin acentos) o `TRIGRAM` (difusa).
- `in_fields` — autofiltro por valores (checklist estilo hoja de cálculo).
- `null_filter_fields` — filtro por nulo/no-nulo.
- `sort_fields` — orden público (con desempate interno estable por PK).
- `field_operators` — operadores extendidos por campo: negación (`ne`), texto
  (`contains`/`starts_with`/`ends_with`), comparación estricta (`gt`/`lt`), conjuntos
  (`not_in`), fecha de calendario (`on`/`before`/`after`/`between`, en la zona horaria
  de la aplicación, DST-safe), `between` numérico y columnas ARRAY (`contains_any`,
  `contains_all`).

Sobre el mismo plan compilado se sirven **facetas** (valores únicos con conteos,
excluyendo el filtro de la propia columna — semántica de Excel) y **agregados**
numéricos (suma/promedio/mín/máx) del pie de tabla. La paginación es offset con conteo,
o **sin total** (`NoTotalCount`) para feeds grandes como la bitácora de auditoría.

## Cómo añadir un recurso

1. Define los schemas por operación en `app/schemas/<recurso>.py` (`XRead`,
   `XListItem`, `XCreate`, `XUpdate`, …) con la metadata de UI en el `Field`
   (`ui.list`, `ui.form`, widget, opciones, label).
2. Crea el `ResourceQuery` con sus `QueryOptions` (qué es filtrable/ordenable/buscable).
3. Registra un `ResourceDefinition` en `RESOURCE_REGISTRY` con permisos, acciones,
   relaciones y detalle.
4. Monta el router de la lista con `ResourceQuery` y los helpers de
   `api/resource_actions.py` (mantén la lógica puntual fuera de los routers).
5. Ejecuta `npm run generate:api` en el frontend y verifica con
   `python -m backend.tests.canonical_suite` + `npm run check:canonical`.

No hay que escribir UI: el recurso aparece completo en `/resources` para los usuarios
cuyo rol lo puede ver.
