# Query Engine Design Debt

Deuda técnica documentada del motor de query (`backend/app/query/`). Estado
actualizado al 2026-07-03: **las cuatro entradas están RESUELTAS** (las
decisiones objetivo se implementaron en el motor y quedaron cubiertas por
tests). Se conserva cada entrada como registro de la decisión y de dónde vive
su implementación.

---

## 1. Semántica de `sort_fields` vacío vs ausente — ✅ RESUELTA

### Decisión implementada

`QueryOptions.sort_fields` es ahora `tuple[str, ...] | None` con default `None`
(`query/options.py`):

```text
sort_fields=None (default)
    Modo derivado: el cliente puede ordenar por todos los campos consultables
    (los declarados en las demás listas de la configuración).

sort_fields=()
    Modo estricto: sin campos de sort públicos. El desempate interno por PK
    sigue activo y el default del servidor sigue aplicando.

sort_fields=("created_at", "name")
    Allowlist explícita.
```

El adaptador `policy_from_options` (`query/policies.py`) traduce el tri-estado
con la misma regla (`None` → `public_sort_fields` = campos consultables).

### Cobertura

`backend/tests/test_query_sort_roles.py::SortFieldsTriStateTest` cubre los tres
casos (derivado, estricto con default estable + tie-breaker, allowlist exacta).

---

## 2. PK pública vs desempate interno — ✅ RESUELTA

### Decisión implementada

Los dos conceptos están separados en `CompiledQueryPlan` (`query/plans.py`) y
los respeta el compiler (`query/compiler.py`):

```text
public_sort_columns
    Allowlist real del cliente. Solo estos campos pueden aparecer en ?sort=.

orderable_columns
    Superconjunto que el default del servidor puede usar (campos consultables
    + primary key). No amplía lo solicitable por el cliente.

tie_breakers
    La primary key (incl. compuesta), añadida internamente por el compiler al
    final del ORDER BY para garantizar orden determinista.
```

La ruta legacy (`compile_list_query` sobre `QueryOptions`) **ya no añade la PK
al conjunto público**: un cliente que pida `sort=id` sin que `id` esté en
`sort_fields` recibe 422 (`unsupported_sort_field`), y el `ORDER BY` siempre
termina en la PK como desempate, sea pública o no. `CompiledQueryPlan.from_schema`
(fallback heredado) reconstruye el orderable como público ∪ PK con la misma regla.

### Cobertura

`backend/tests/test_query_sort_roles.py` (`LegacyVsNativePkTest`: la PK es
interna en ambos caminos y solicitable solo si se declara;
`OrderableDefaultTest`: el default del servidor puede usar campos no públicos).

---

## 3. Taxonomía de errores de `default_sort` — ✅ RESUELTA

### Decisión implementada

`default_sort` se valida ANTES de resolver columnas (`query/factory.py`):

```text
default_sort mal formado ("-", "a,,b", "a,a")
    → invalid_default_sort

default_sort apunta a campo no permitido como sort
    → invalid_default_sort

default_sort apunta a campo que no existe en el schema público
    → invalid_default_sort   (antes: invalid_schema_column_mapping)

Campo existe en schema, pero no tiene columna ORM ni binding válido
    → invalid_schema_column_mapping

Binding configurado, pero no es una expresión SQLAlchemy válida
    → invalid_column_binding
```

La PK se admite en `default_sort` aunque no esté en el schema público (es el
desempate estable y el default derivado cuando no se configura orden), por lo
que el guard `missing_default_sort` dejó de ser alcanzable en la ruta legacy.

### Cobertura

`backend/tests/test_query_helpers.py::QueryHelperFactoryTest`
(`test_factory_rejects_invalid_configured_default_sort` con los códigos de la
tabla y `test_default_sort_derives_from_pk_even_when_pk_is_not_public`).

---

## 4. `str_strip_whitespace` en `QuerySchema` — ✅ RESUELTA (decisión documentada)

### Decisión implementada

Se CONFIRMA el comportamiento global como contrato de la plataforma:
`QuerySchema` mantiene `str_strip_whitespace=True` y aplica a **todos** los
parámetros string públicos por igual:

```text
sort:
    Aplica strip (" -created_at " → "-created_at"): el espacio periférico es
    ruido del cliente, no una señal.

q (búsqueda):
    Aplica strip ("  admin  " → "admin").

Filtros de texto (name, email, códigos…):
    Aplica strip. El espacio PERIFÉRICO nunca es significativo en los valores
    de filtro de esta plataforma; los espacios interiores se conservan.
```

Si algún dominio futuro necesitara espacio periférico significativo en un
valor de filtro, eso exigirá control por campo en la factory (nueva decisión,
no un default distinto): lo no declarado seguirá heredando el strip global.

### Cobertura

`backend/tests/test_query_sort_roles.py::SortFieldsTriStateTest::test_public_string_params_strip_surrounding_whitespace`.
