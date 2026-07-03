# Diseño Fase 2 — `QueryPolicy`, plan compilado y extensibilidad del motor de query

> Documento de diseño. **No contiene código de implementación**; los bloques son
> conceptuales. Aprobado para versionar antes de iniciar la implementación de Fase 2.

## Estado de partida

El motor (commit `bcee760`) usa `QueryOptions` (listas paralelas `filter_fields`/
`sort_fields`/`search_fields`/`in_fields`/`null_filter_fields` + `column_bindings`
+ `default_sort` + límites `max_*`), `factory.make_offset_query_schema` que genera
un `OffsetQuerySchema` dinámico e inyecta metadata SQLAlchemy como atributos
`__query_*__` sobre la clase Pydantic, `compiler.apply_query_schema`,
`executor.paginate` y `ResourceQuery`. Las cuatro deudas del extinto
`QUERY_DESIGN_DEBT.md` quedaron RESUELTAS (2026-07-03): `sort_fields` tri-estado
(None/()/allowlist), PK fuera del sort público (tie-breaker + orderable),
taxonomía `invalid_default_sort` y `str_strip_whitespace` global confirmado como
contrato. Cobertura: `test_query_sort_roles.py` y `test_query_helpers.py`; el
registro detallado vive en el historial de git de ese archivo.

**Principio rector:** reorganizar y explicitar sin cambiar el comportamiento
observable del caso simple. Cada paso deja la suite verde (75/69/6/0) mediante un
adaptador de compatibilidad.

---

## Decisión 1 — `QueryPolicy`: una regla por campo

**Problema actual.** La capacidad de un campo se reparte en 5–6 listas paralelas;
conocer `created_at` exige inspeccionar varias tuplas y nada impide inconsistencias.

**Objetivo.** Una sola declaración por campo (operadores, búsqueda, sort, binding
ORM, metadata UI); fuente única para generar `XQuery`, validar, compilar SQLAlchemy
y construir capabilities (Fase 6).

**Propuesta de modelo conceptual.**

```text
Operadores REALES (únicos que generan parámetro):
    eq      -> {name}
    in      -> {name}_in
    isnull  -> {name}_isnull
    gte     -> {name}_gte
    lte     -> {name}_lte

'range'  NO es operador: es atajo de configuración que se normaliza a {gte, lte}.
'searchable' NO es operador: es una capacidad separada para participar en q;
             no genera operador ni parámetro por campo.

FieldSpec
    name        nombre público
    type        default: tipo del campo en XListItem; si no existe, en XRead
    source      default: getattr(model, name)
    operators   subconjunto de {eq, in, isnull, gte, lte}
    searchable  bool (contribuye una columna a q)
    ui          label/description/widget/group/visible_as_filter/visible_as_sort
    constraints max_length, etc.

QueryPolicy
    fields       mapping ordenado name -> FieldSpec
    search       min_len, max_len, default_strategy
    sort         orderable_fields, public_sort_fields, tie_breakers, default_order
    pagination   default_limit, max_limit
    limits       max_in_values, max_filter_text_length, max_sort_terms, max_sort_length
```

**Reglas y defaults.** Operadores derivados por tipo si no se declaran:

```text
str / EmailStr   {eq}            (+ q si searchable)
bool             {eq}
UUID             {eq, in}
Enum             {eq, in}
int / Decimal    {eq, gte, lte}   (config 'range' -> gte+lte)
date / datetime  {gte, lte}
columna nullable + {isnull}       (opt-in)
```

`str_strip_whitespace` **permanece en `QuerySchema`** (no migra a `FieldSpec` en
Fase 2): el query genérico representa entrada humana; los parámetros opacos (tokens,
cursores) deben usar schemas/endpoints especializados.

**Qué puede personalizar una ruta manual.** Nada en la policy (estática por
recurso, definida a nivel de módulo). La ruta elige el contrato/policy y construye
el `stmt` base.

**Qué permanece interno y qué llega al frontend.** `source`/bindings y handlers de
operador son **internos**. Al frontend (Fase 6) llega solo `name`, `type`,
`operators` (nombres), `searchable`, `ui.*`. Los **campos query-only** (declaran
`type` y `source` explícitos y no existen en `XRead`/`XListItem`) **no aparecen en
UI por defecto** (`ui = None`).

**Compatibilidad con `QueryOptions` actual.** `QueryOptions` se conserva como
adaptador heredado: `to_policy(read_schema, model)` proyecta sus listas a
`FieldSpec`. `make_offset_query_schema(options=...)` sigue igual.

**Riesgos y casos límite.** (a) Default sorprendente en fechas → documentar tabla y
exigir declaración explícita si se quiere `eq`. (b) Campo del schema sin `FieldSpec`
→ **no consultable** (allowlist). (c) Colisión de `name` con `_gte/_lte/_in/_isnull`
o reservados → se conserva la validación actual.

**Criterios de aceptación y pruebas requeridas.** La policy derivada por `to_policy`
genera **el mismo `XQuery`** (mismos `model_fields`) que hoy para los recursos de
`test_query`/`test_query_helpers`; tests nuevos: derivación de operadores por tipo,
`range`→`gte+lte`, `searchable` sin parámetro propio, `type` derivado de XListItem
con fallback XRead, campo no declarado → no consultable, campo query-only fuera de UI.

**Archivos que cambiarían.** Nuevos `query/fields.py`, `query/policies.py`,
`query/operators.py`. Modificados `query/options.py` (adaptador `to_policy`),
`query/factory.py` (consume policy).

---

## Decisión 2 — Sort en tres roles, orden por defecto y desempate

**Problema actual.** `factory` mete la PK en `__query_sort_columns__`, que el
compiler usa tanto para validar lo solicitable como para el desempate → la PK queda
pública sin configurarla (deuda B); `sort_fields=()` es ambiguo (deuda A); el
desempate compara columnas por presencia frágil; la taxonomía de `default_order` no
está fijada (deuda C).

**Objetivo.** Tres roles de orden con responsabilidades separadas, reglas explícitas
de `ORDER BY`/desempate y taxonomía cerrada de errores de orden por defecto.

**Propuesta de modelo conceptual.**

```text
Tres roles de orden con responsabilidades separadas:

orderable_fields:
    campos que la policy puede usar internamente.

public_sort_fields:
    subconjunto de orderable_fields permitido al cliente con ?sort=.

tie_breakers:
    expresiones internas añadidas para estabilidad (default: identidad).

default_order:
    orden por defecto; puede usar orderable_fields aunque el sort público
    esté prohibido (p. ej. default_order="-created_at" con public_sort_fields=()).
```

`tie_breakers` puede coincidir lógicamente con un campo público declarado
explícitamente, como `id`: lo que cambia no es necesariamente la expresión, sino su
**rol y exposición**.

Semántica de configuración (deuda A):

```text
sort_fields = None   derivar public_sort_fields de los campos con sort habilitado
sort_fields = ()     prohibir sort público (default_order + tie_breakers siguen)
sort_fields = (...)  allowlist explícita
```

**Reglas y defaults.** `tie_breakers` por defecto = las expresiones del
`IdentitySpec` (PK, posiblemente compuesta — Decisión 6). Regla explícita de
`ORDER BY` (no es un riesgo abierto):

```text
el stmt base CONSERVA JOIN, WHERE, HAVING y scopes;
la policy REEMPLAZA cualquier ORDER BY previo del stmt base;
aplica default_order (si no hay ?sort=) o el sort solicitado;
añade los tie_breakers que falten.
```

**Deducción de desempates:** no se usa identidad de objeto SQLAlchemy. Cada fuente
de sort (campo o tie-breaker) tiene una **clave lógica estable** en el plan; un
tie-breaker se omite solo si su clave lógica ya fue solicitada.

Taxonomía de errores de orden por defecto (deuda C):

| Situación de configuración                                                       | Código                          |
| -------------------------------------------------------------------------------- | ------------------------------- |
| `default_order` vacío, mal formado, repetido o con dirección inválida            | `invalid_default_sort`          |
| `default_order` referencia una clave que no existe en `orderable_fields`         | `invalid_default_sort`          |
| Un `FieldSpec` debía resolver una fuente ORM y no puede hacerlo                   | `invalid_schema_column_mapping` |
| Una fuente o binding declarado no es una expresión SQLAlchemy válida para query   | `invalid_column_binding`        |

Regla clave: **un error de orden por defecto no debe convertirse accidentalmente en
error de mapping**, salvo que el campo exista como regla pero su fuente sea inválida
durante la compilación de la policy.

**Qué puede personalizar una ruta manual.** Elegir contrato/policy. El `stmt` base
puede traer su propio `order_by`, pero **la policy lo reemplaza** (documentado); si
la ruta necesita un orden no expresable, usa un contrato cuya policy lo declare.

**Qué permanece interno y qué llega al frontend.** `orderable_fields` y
`tie_breakers` son **internos**; al frontend solo llega `public_sort_fields`.

```text
default_order solo se expone como default_sort cuando todos sus términos
sean públicamente solicitables.

Si usa un campo interno no público:
    capabilities no debe revelar la clave cruda;
    puede describirse como orden fijo del servidor.
```

**Compatibilidad con `QueryOptions` actual.** El adaptador **preserva la semántica
heredada**, incluida la posibilidad histórica de ordenar por PK cuando hoy resulta
posible (mapea `sort_fields` actuales a `public_sort_fields` conservando la PK
solicitable si lo era). La `QueryPolicy` **nativa** trata la PK como interna salvo
declaración explícita. Esta compatibilidad se materializa **solo al adaptar
`QueryOptions`**, no mediante una bandera pública añadida a la API nueva.

**Riesgos y casos límite.** (a) `default_order` con campo no `orderable` → error de
configuración (`invalid_default_sort`). (b) Alias/expresión que represente la
identidad → su clave lógica evita duplicar el tie-breaker. (c) `stmt` base con
`order_by` intencional → la policy lo reemplaza (documentado).

**Criterios de aceptación y pruebas requeridas.** Vía nativa: `sort=id` con `id`
fuera de `public_sort_fields` → 422; `default_order="-created_at"` con
`public_sort_fields=()` ordena pero rechaza `?sort=`. Vía adaptador: comportamiento
actual de PK intacto. Tabla de taxonomía cubierta por casos. `StableSortTest`/
`CompositePkStableSortTest` siguen verdes; el `ORDER BY` final siempre incluye la
identidad.

**Archivos que cambiarían.** `query/policies.py` (tres roles + `default_order` +
taxonomía), `query/compiler.py` (`_apply_sort` con claves lógicas + reemplazo de
ORDER BY), `query/plans.py` (Decisión 3).

---

## Decisión 3 — `CompiledQueryPlan` explícito (sin romper `factory`)

**Problema actual.** La metadata SQLAlchemy vive como atributos dinámicos
`__query_*__` sobre la clase Pydantic: mezcla contrato HTTP con detalle interno,
dificulta tipado, pruebas y múltiples ejecutores.

**Objetivo.** Separar el `XQuery` (Pydantic puro) del `CompiledQueryPlan` (metadata
tipada) **sin cambiar la firma histórica de `factory`**.

**Propuesta de modelo conceptual.**

```text
make_offset_query_schema(...)  ->  type[OffsetQuerySchema]   (retorno HISTÓRICO; no cambia)

compile_list_query(...)        ->  CompiledListQuery
                                       .schema   (XQuery Pydantic)
                                       .plan     (CompiledQueryPlan)

CompiledQueryPlan
    filter_columns, all_columns,
    range_fields, in_fields, null_filter_fields,
    orderable_fields, public_sort_fields, tie_breakers (con clave lógica),
    search_columns + strategy,
    identity (IdentitySpec),
    limits, operator_handlers
```

`apply_query_schema` y `paginate` aceptan un **`plan` opcional**; si no se pasa,
mantienen el **fallback** a los `__query_*__` actuales.

**Reglas y defaults.** El plan se compila una sola vez (a nivel de módulo, vía
`ListQueryContract`). El `XQuery` no expone nada del plan.

**Qué puede personalizar una ruta manual.** Nada; recibe `(query, plan)` a través
del contrato.

**Qué permanece interno y qué llega al frontend.** `CompiledQueryPlan` es
**totalmente interno**; capabilities (Fase 6) leen la `QueryPolicy`, no el plan.

**Compatibilidad con `QueryOptions` actual.** Coexistencia: `make_offset_query_schema`
sigue devolviendo el schema **y** (transitoriamente) haciendo `setattr __query_*__`;
los callers nuevos usan `compile_list_query`. Los `__query_*__` se retiran solo
cuando no queden callers/tests dependientes.

**Riesgos y casos límite.** (a) `test_query_helpers` inspecciona
`WidgetQuery.__query_columns__`: durante la transición sigue funcionando; se migra a
leer el plan en el último paso. (b) No se requiere serializar el plan (vive en
memoria).

**Criterios de aceptación y pruebas requeridas.** `compile_list_query(...).schema` ≡
`make_offset_query_schema(...)`; `apply_query_schema(stmt, query, plan)` produce el
mismo SQL (comparación por dialecto PG reutilizando `test_query_postgres`); con
`plan=None`, fallback idéntico al actual.

**Archivos que cambiarían.** Nuevo `query/plans.py`. Modificados `query/factory.py`
(añade `compile_list_query`, conserva `make_offset_query_schema`), `query/compiler.py`
y `query/executor.py` (parámetro `plan` opcional + fallback), `query/schema.py` (los
`__query_*__` se retiran en el último paso).

---

## Decisión 4 — Compatibilidad temporal: `QueryOptions` ↔ `QueryPolicy`

**Problema actual.** Reemplazar `QueryOptions` de golpe rompería `ResourceQuery`,
los recursos de los tests y cualquier uso ya escrito.

**Objetivo.** Convivencia: `QueryOptions` sigue válido (adaptado a `QueryPolicy`) y
`QueryPolicy` es la API nueva recomendada.

**Propuesta de modelo conceptual.**

```text
Camino heredado:
    ResourceQuery(..., options=QueryOptions(...))
    make_offset_query_schema(..., options=...)
    -> QueryOptions.to_policy(...)
    -> compilación interna desde la policy adaptada.

Camino nuevo:
    ListQueryContract(..., policy=QueryPolicy(...))
    compile_list_query(..., policy=...)
    -> CompiledListQuery(schema, plan).

Regla:
    un contrato recibe policy o options, nunca ambos.

Compatibilidad:
    make_offset_query_schema conserva su retorno histórico:
    type[OffsetQuerySchema].
```

La compatibilidad de **PK pública** se materializa **solo al adaptar `QueryOptions`**,
no mediante una bandera pública añadida a la API nueva.

**Reglas y defaults.** `to_policy` es la **única** traducción (no se duplica
validación). `QueryOptions` conserva `frozen=True/slots=True`. **No se fija fecha de
eliminación ni se emiten warnings durante Fase 2**: queda soportado y documentado
como heredado.

**Qué puede personalizar una ruta manual.** Elegir camino heredado o nuevo sin
cambiar el resto del endpoint; la firma de `paginate`/`ResourceQuery.paginate` no
cambia.

**Qué permanece interno y qué llega al frontend.** Sin impacto en frontend (API de
backend).

**Compatibilidad.** Es la garantía central: la suite actual pasa **sin tocar los
tests** (siguen usando `QueryOptions`). Tests nuevos cubren el camino nuevo y la
equivalencia heredado≡nuevo.

**Riesgos y casos límite.** (a) Divergencia sutil entre caminos → test de
**equivalencia** que compile el mismo recurso por ambos y compare `model_fields` +
SQL emitido. (b) Semánticas heredadas (PK solicitable) viven **solo** en el adaptador,
no en la policy nativa.

**Criterios de aceptación y pruebas requeridas.** Suite actual verde sin
modificaciones; test de equivalencia heredado≡nuevo; `ListQueryContract(..., policy=...)`
y `ResourceQuery(..., options=...)` funcionan; `QueryOptions` documentado como
heredado, sin warnings.

**Archivos que cambiarían.** `query/options.py` (`to_policy`, doc heredada),
`query/contracts.py` (nuevo, `ListQueryContract`), `query/resource.py` (fachada de
compatibilidad), `query/__init__.py` (exporta `QueryPolicy`, `FieldSpec`,
`ListQueryContract`).

---

## Decisión 5 — Extensiones de query y orden del pipeline

**Problema actual.** El motor asume `source = columna directa` o un `column_bindings`
simple; la ruta puede pasar `stmt`, pero no hay forma declarativa de mapear un campo
público a una columna de otra tabla/expresión, ni de enchufar búsqueda no-`ilike`,
ni un orden de aplicación definido.

**Objetivo.** Mapear campos públicos a expresiones SQLAlchemy y enchufar
estrategias/extensiones, con un **pipeline de aplicación explícito**, sin exponer SQL
al frontend ni romper el caso simple.

**Propuesta de modelo conceptual.**

```text
Abstracciones:
    ListQueryContract   abstracción principal nueva
                        (model, schema, policy, plan, count/serializer strategies)
    ResourceQuery       fachada/adaptador TEMPORAL de compatibilidad

FieldSpec.source puede ser:
    columna directa (default) | columna de otra tabla/alias (la ruta hace el JOIN)
    | expresión calculada/agregada/subconsulta correlacionada

SearchStrategy (interfaz):  ilike (default) | <futuras>  -> (columns, value) -> predicado
QueryExtension (hook opcional del contrato): filtros/búsqueda no declarativos

Orden del pipeline (definido, no implícito):
    stmt base
    -> filtros declarativos
    -> extensiones especiales (QueryExtension)
    -> búsqueda global (q)
    -> reemplazo de ORDER BY (default_order o ?sort=)
    -> tie_breakers
    -> count y página
```

Contrato de `QueryExtension`:

```text
QueryExtension recibe:
    stmt,
    query validado,
    plan,
    contexto explícito opcional.

Devuelve:
    un nuevo Select.

Múltiples extensiones:
    se ejecutan en el orden en que fueron declaradas por el contrato.

La ruta:
    puede aplicar scopes, permisos y filtros base al construir stmt.

La ruta no debe:
    añadir filtros, búsqueda u ORDER BY después de que el motor haya
    aplicado la policy.

Casos que requieran transformación posterior:
    usan un contrato, estrategia o executor especializado;
    no un callback libre desde la ruta.
```

**Reglas y defaults.** Default = columna directa + `ilike`. Bindings/estrategias/
extensiones son **opt-in** por campo o contrato. Una expresión que participe en sort
debe tener **clave lógica** (Decisión 2) para el desempate.

**Qué puede personalizar una ruta manual.** El `stmt` base (JOIN/subqueries/scopes/
tenant) y la elección de contrato. Para lógica única, un `QueryExtension` declarado
por el contrato; nunca un callback libre que altere el pipeline después de la policy.

**Qué permanece interno y qué llega al frontend.** Expresiones, joins y estrategias
son **internas**; el frontend ve `{name, type, operators, searchable}`. Nunca sabe
que `organization_name` viene de `Organization.name`.

**Compatibilidad con `QueryOptions` actual.** `column_bindings` → `FieldSpec.source`.
`select(Model)` simple no cambia. Estrategias avanzadas (trigram/full-text) son
**Fase 8**; aquí solo la **interfaz** `SearchStrategy` con `ilike` como única
implementación.

**Riesgos y casos límite.** (a) Binding cross-table sin el join en `stmt` → error
SQL; contrato: "si declaras binding cross-table, tu `stmt` debe incluir el join";
validar lo posible en compile-time. (b) Sort sobre agregada exige `GROUP BY`
(Decisión 6). (c) Relaciones 1:N: preferir `EXISTS`/`any()` a join multiplicador.

**Criterios de aceptación y pruebas requeridas.** Campo bindeado a otra tabla
filtra/ordena con un `stmt` que incluye el join; `SearchStrategy` default = `ilike`
(escape actual verde); un `QueryExtension` de ejemplo añade un filtro custom
respetando el orden del pipeline.

**Archivos que cambiarían.** `query/operators.py`, nuevo `query/search.py`
(`SearchStrategy`), `query/fields.py` (`source` expresión), `query/compiler.py`
(pipeline + estrategia), `query/contracts.py` (`QueryExtension`). La firma de ruta no
cambia.

---

## Decisión 6 — Conteo, identidad y serialización

**Problema actual.** `executor.paginate` cuenta sobre subquery y serializa con
`model_validate(row, from_attributes=True)`: correcto para `select(Model)` 1:1; con
joins 1:N el `total` cuenta filas duplicadas y con proyecciones `from_attributes` no
aplica.

**Objetivo.** Conteo y serialización configurables, anclados en una identidad
explícita, sin complicar el caso simple.

**Propuesta de modelo conceptual.**

```text
IdentitySpec
    expresiones que identifican un "recurso único". Usado por el conteo y por
    el desempate de sort.

CountStrategy:
    AutomaticCount          subquery + COUNT(*)                          default
    DistinctIdentityCount   COUNT sobre subconsulta con SELECT DISTINCT de
                            TODAS las expresiones de identidad
                            (no COUNT(DISTINCT pk) simplificado)
    CustomCountStatement    statement de conteo provisto por el contrato
    NoTotalCount            (POSPUESTO a Fase 8)

RowSerializer:
    EntitySerializer     model_validate(entity, from_attributes=True)   default
    ProjectionSerializer model_validate(row._mapping)
    CustomSerializer     callable -> schema o datos compatibles con schema
```

Origen obligatorio del `IdentitySpec`:

```text
ListQueryContract con modelo ORM:
    IdentitySpec se deriva de mapper.primary_key.

ListQueryContract sobre proyección, agregado o resultado no-entidad:
    IdentitySpec debe declararse explícitamente.

Sin IdentitySpec:
    no se permite construir un contrato estándar de offset pagination.
```

`CustomCountStatement`:

```text
CustomCountStatement recibe el statement ya filtrado,
sin ORDER BY, OFFSET ni LIMIT.

No recibe una consulta independiente sin contexto,
para impedir que total e items diverjan.
```

El `executor` se parametriza por `(plan, count_strategy, row_serializer)`.

**Reglas y defaults.** Defaults = `AutomaticCount` + `EntitySerializer` (idéntico al
actual). El `total` siempre se calcula con **los mismos filtros** que los items
(regla actual preservada). `DistinctIdentityCount` se construye sobre
`SELECT DISTINCT (<expresiones de identidad>)`, válido para PK compuesta. La
paginación offset estándar **siempre** requiere sort estable, por lo que el
`IdentitySpec` es obligatorio para todo listado offset (derivado para entidades,
declarado para no-entidades).

**Qué puede personalizar una ruta manual.** Elegir estrategia de conteo/serialización
vía el contrato; en casos extremos, `count_stmt`/`serializer` propios declarados por
el contrato.

**Qué permanece interno y qué llega al frontend.** Estrategias internas.
`OffsetPagination.total` sigue siendo `int` obligatorio en Fase 2 (no se introduce
`NoTotalCount`), así que el contrato de respuesta no cambia.

**Compatibilidad con `QueryOptions` actual.** Sin impacto: el default reproduce el
comportamiento de hoy. `DistinctIdentityCount`/`ProjectionSerializer` son opt-in del
contrato nuevo.

**Riesgos y casos límite.** (a) Proyección sin identidad → no se permite construir
un contrato offset estándar. (b) Conteo con `HAVING`/`GROUP BY` → requiere
subconsulta envolvente correcta. (c) `IdentitySpec` debe coincidir con los
`tie_breakers` por defecto para coherencia entre conteo y orden.

**Criterios de aceptación y pruebas requeridas.** `AutomaticCount` mantiene
resultados actuales (`test_query`/`BaseStatementTest` verdes); `DistinctIdentityCount`
sobre un join 1:N de prueba devuelve `total` = entidades únicas (no filas);
`ProjectionSerializer` serializa un `select` de columnas a un schema; el conteo sigue
descartando `order_by`; identidad compuesta cubierta.

**Archivos que cambiarían.** Nuevos `query/identity.py` (`IdentitySpec`),
`query/count_strategies.py`, `query/serializers.py`. Modificados `query/executor.py`
(estrategias), `query/contracts.py` (declara estrategias).

---

## No objetivos de Fase 2

```text
- Capabilities completas y endpoint por recurso         -> Fase 6
- Acciones no-CRUD (ActionContract/ActionHandler)        -> Fase 5
- Permisos integrados / PermissionResolver               -> Fase 6
- Cursor / keyset pagination                             -> Fase 8
- NoTotalCount / feeds sin total                          -> Fase 8
- Búsqueda avanzada real (trigram/full-text/unaccent)    -> Fase 8
  (en Fase 2 solo la interfaz SearchStrategy)
- Filtros JSONB/arrays/geoespacial/rangos PG             -> Fase 8
- Cliente TypeScript / checks OpenAPI                     -> Fase 7
- Migrar str_strip_whitespace a FieldSpec                 -> no se hará
- Fijar fecha de eliminación de QueryOptions / warnings   -> no en Fase 2
```

## Plan de migración

```text
Paso 0  Aprobar diseño + commit documental aislado.

Paso 1  FieldSpec + QueryPolicy + adaptador QueryOptions -> QueryPolicy.
        Sin cambiar API pública de factory ni compiler.
        => Suite actual verde sin tocar tests.

Paso 2  CompiledListQuery + CompiledQueryPlan. Nueva API de compilación
        (compile_list_query). make_offset_query_schema conserva su retorno
        histórico (el schema).

Paso 3  ListQueryContract usa plan explícito; compiler/executor aceptan
        plan opcional con fallback heredado a __query_*__.

Paso 4  orderable_fields + public_sort_fields + tie_breakers + default_order.
        Compatibilidad legacy (PK solicitable) encapsulada en el adaptador
        QueryOptions; policy nativa trata PK como interna.

Paso 5  IdentitySpec + DistinctIdentityCount + serializers
        + interfaz SearchStrategy (ILIKE como única implementación).

Paso 6  Retirar __query_*__ solo cuando no queden callers ni tests
        dependientes de esa metadata.

Regla transversal: cada paso es un commit que deja la suite verde
(75/69/6/0) y no requiere cambiar los endpoints existentes.
Los 6 PgIntegrationTest siguen gated; Fase 0 se cierra aparte.
```
