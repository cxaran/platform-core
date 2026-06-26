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
