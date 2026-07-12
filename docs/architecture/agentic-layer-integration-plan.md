# Plan de integración: capa agéntica + model-gateway en platform-core

**Estado:** propuesta (sin implementar) · **Fecha:** 2026-07-09
**Alcance acordado:** lectura + escritura, con escrituras bajo aprobación human-in-the-loop.
**Objetivo:** dotar a platform-core de un copiloto (chat agéntico) cuyo conjunto de
herramientas se **deriva automáticamente del contrato de recursos** (`GET /api/v1/resources`),
respetando el RBAC ya existente, portando la arquitectura probada en el fork MedicoPilot.

---

## 0. Principio rector (invariante de diseño)

Se preserva la separación de tres autoridades de MedicoPilot, que es la fuente de todas
las garantías de seguridad:

| Autoridad | Responsable | Nunca hace |
| --- | --- | --- |
| **Datos + RBAC** | FastAPI (platform-core backend) | No almacena credenciales del LLM en claro |
| **Proveedor de IA** | `model-gateway` (servicio TS nuevo) | No ve datos del negocio; no ejecuta tools |
| **Ejecución de tools** | Navegador del usuario | No tiene identidad propia: usa la cookie del usuario |

Reglas invariantes que el plan no debe romper:

1. El gateway **relaya**, no ejecuta tools ni orquesta. Datos del negocio nunca lo atraviesan.
2. Toda tool se ejecuta en el navegador contra la REST con la **cookie del usuario**; FastAPI
   revalida permisos en cada endpoint. El agente no puede hacer nada que el usuario no pueda.
3. El catálogo de tools se **deriva** del contrato ya filtrado por RBAC; no se declara a mano.
4. Toda tool de **escritura** (`create`/`update`/`action`/`relation`) queda en `awaiting_approval`;
   se ejecuta el **payload exacto aprobado**, no los argumentos crudos del modelo. El payload
   sensible nunca sale del navegador hacia el gateway.
5. Las credenciales del proveedor se **arriendan por turn**, cifradas en reposo con Fernet.

---

## 1. Arquitectura objetivo

```
Navegador (usuario autenticado)
  │  1. POST /api/v1/agent/connection-ticket   (cookie de sesión)
  ├──────────────────────────────────────────────────────────►  FastAPI  (autoridad de datos/RBAC)
  │  ◄── ticket JWT (aud=agent-gateway, atado a User.token) ───   backend
  │                                                                 ▲   ▲
  │  2. POST {gw}/v1/browser-sessions {ticket}                      │   │ HTTP interno (X-Internal-Auth):
  │  3. WS  {gw}/v1/ws  (turn.start: messages, tools, model)        │   │ POST /internal/agent/credential-lease
  ▼                                                                 │   │ GET  /api/v1/auth/me (sesión viva)
┌───────────────┐  authorizeTurn · leaseCredential · verify-me ────┘   │
│ model-gateway │──────────────────────────────────────────────────────┘
│  (Fastify TS) │  ── startTurn ──►  ProviderAdapter ──►  OpenAI/Anthropic/Gemini/local
└───────────────┘  ◄── text.delta · tool_call.ready · usage ──
  │  turn.tool_call.ready
  ▼
Navegador  ── ejecuta tool: buildXxxPayload + browserApi (cookie) ──►  FastAPI (revalida RBAC)
  │  (write ⇒ aprobación local; payload exacto NO viaja al gateway)
  │  turn.tool_result ──► gateway ── resumeTurn ──► provider ──► turn.completed
```

Rutas nginx: el gateway se sirve bajo el **mismo origen** que el frontend, en
`/model-gateway/` (para que el navegador reenvíe la cookie de sesión al gateway).

---

## 2. Estado de partida (qué ya existe en platform-core)

**Ya listo (no hay que construirlo):**

- Contrato de recursos completo: `backend/app/resources/registry.py` (RESOURCE_REGISTRY),
  `backend/app/resources/projection.py` (proyección filtrada por RBAC),
  `GET /api/v1/resources` y `/{name}` (`backend/app/api/v1/resources.py`).
- Motor de query allowlist (`backend/app/query/`) con `CompiledQueryPlan` → parámetros HTTP exactos.
- RBAC declarativo (`backend/app/security/`), `SessionUser.permissions`.
- Frontend contract-driven: `src/core/api/contracts.ts` (alias sobre OpenAPI),
  `src/core/resources/*` con builders seguros (`buildListSearchParams`, `buildCreatePayload`,
  `buildUpdatePayload`, `resolveActionUrl`/`actionBody`), `browserApi`, `embedded-list-client.ts`
  (ya rotulado "shell chat-first"), `ResourceTable` en modo embebido.
- Cifrado Fernet en reposo (`services/secret_cipher`), settings fail-closed.

**No existe (hay que traerlo):**

- El servicio `model-gateway/`.
- El módulo backend `app/agent/` (tickets, credential-lease, oauth opcional) y el modelo
  `AiProviderCredential`.
- Todo `frontend/src/core/agent/**` y `frontend/src/components/copilot/**`.

---

## 3. Fases de implementación

El orden A → B → C permite verificar cada capa antes de apilar la siguiente.

### FASE A — Servicio `model-gateway` + backend de conexión

**A.1 — Copiar el servicio (genérico casi al 100%)**
- Copiar `medicopilot/model-gateway/` → `platform-core/model-gateway/` completo.
- Auditar y eliminar cualquier referencia de dominio clínico: el gateway es neutral, pero
  revisar `README.md` y namespaces de ejemplo (`clinical.*`) en comentarios/tests. La lógica
  (`domain/`, `ports/`, `application/`, `providers/`, `transport/`) no toca dominio.
- Ajustar `package.json` name → `@platform-core/model-gateway`.

**A.2 — Backend Python: módulo `app/agent/`**
- Portar `backend/app/agent/ticket.py`:
  `issue_connection_ticket` / `verify_connection_ticket` (JWT HS256, `aud="agent-gateway"`,
  claims `sub`=user_id + `sid`=`User.token`; rotar sesión invalida tickets).
- Portar `backend/app/agent/crypto.py` (Fernet, delega en `services/secret_cipher` ya existente).
- Portar OAuth PKCE (`agent/oauth.py`) **solo si** se quiere conectar cuentas ChatGPT/Codex;
  para v1 con API keys es opcional → marcar como fase A.4 diferible.

**A.3 — Backend Python: endpoints**
- `api/v1/agent.py`: `POST /api/v1/agent/connection-ticket` (usuario autenticado).
- `api/v1/agent_internal.py`: `POST /api/v1/internal/agent/credential-lease`
  (server-to-server, valida `X-Internal-Auth` con `compare_digest`, rate-limit, devuelve
  secreto descifrado de vida corta). Auditar sin el secreto.
- `api/v1/ai_providers.py`: CRUD de credenciales de proveedor (recurso del contrato,
  con su `SecurityGroup` nuevo → ver §4).
- Modelo `models/ai_provider_credential.py` (`AiProviderCredential`: provider, tipo, secreto
  cifrado, account_id opcional, activo) + migración Alembic.
- Settings nuevos en `core/settings.py`: `agent_gateway_ticket_signing_secret`,
  `agent_gateway_ticket_ttl_seconds`, `agent_gateway_internal_secret`,
  `agent_gateway_lease_ttl_seconds`. Sin defaults (fail-closed), documentados en `.env.example`.
- Registrar routers en `api/v1/router.py`.

**A.4 — Infra (compose + nginx)**
- `compose.yml`: añadir servicio `model-gateway` (build target prod, expone 8081,
  `depends_on` backend). **Nota:** en MedicoPilot el gateway quedó fuera del compose de prod
  por error — aquí se hace bien desde el inicio.
- `compose.dev.yml`: servicio con hot-reload (tsx watch), env inline.
- `nginx/nginx.conf`: `location /model-gateway/ { proxy_pass http://model-gateway:8081; }`
  con upgrade WebSocket (`Upgrade`/`Connection` headers).
- Variables: `GATEWAY_AGENT_TICKET_SECRET`, `GATEWAY_BACKEND_INTERNAL_URL`,
  `GATEWAY_BACKEND_INTERNAL_SECRET`, `GATEWAY_PUBLIC_PATH_PREFIX=/model-gateway`, origins allowlist.

**Verificación Fase A:**
- Levantar stack dev; `POST /connection-ticket` con cookie devuelve JWT válido.
- `POST {gw}/v1/browser-sessions {ticket}` crea sesión; WS conecta.
- `turn.start` con provider `fake` completa un turn (streaming de deltas).
- Tests: portar `test_agent_ticket.py`, `test_agent_internal_lease.py`; suite Vitest del gateway.

---

### FASE B — Framework agéntico del frontend (genérico)

Portar a `platform-core/frontend/src/core/agent/**` (lógica pura, con sus `.test.ts`):

**B.1 — Conexión y protocolo**
- `agent-client.ts` (handshake ticket→session→WS, stream de eventos). Configurable:
  `gatewayUrl` (`NEXT_PUBLIC_AGENT_GATEWAY_URL`), `ticketPath`.
- `protocol.ts` (tipos del cable snake_case: `ClientMessage`, `ServerEvent`, `WireTool`, …).
- `turn-reducer.ts`, `reconnect-machine.ts`, `turn-error.ts`.

**B.2 — Framework de tools**
- `tools/tool-runner.ts`, `tools/schema-validator.ts`, `tools/sandbox.ts`.
- Infra de `tools/registry.ts`: extraer SOLO el andamiaje genérico
  (`ToolDefinition`, `ToolKind`, `ToolApprovalMeta`, `listTools`/`getTool`,
  `toWireToolDefinitions`, gating `effectiveTools` por permisos). **Dejar el registro
  de dominio vacío**: platform-core no trae tools hand-written; las suyas se derivan (B.3).
- `tool-catalog.ts`, `tool-discovery.ts`, `tool-notes.ts`, `start-suggestions.ts`.

**B.3 — El puente con el contrato (núcleo del objetivo)**
- Portar `tools/contract-tools.ts` (`deriveResourceTools`). Ya es genérico en MedicoPilot.
  Adaptar los tipos de entrada a los alias de `contracts.ts` de platform-core
  (`ResourceCapability`, `FilterableFieldCapability`, `ResourceFormFieldCapability`,
  `ResourceActionCapability`). Ver §5 para el mapeo detallado.

**B.4 — UI declarativa y aprobación**
- `tools/ui-spec.ts` (kinds genéricos: `form`, `chart`, `buttons`, `suggested_replies`,
  `dynamic_form`, `wizard`, `resource_form`) + `components/copilot/GeneratedUi.tsx`
  (parseo seguro, nunca HTML crudo; `isSafeButtonUrl` allowlist).
- `approval-protocol.ts` → **renombrar `ClinicalActionPlan` a `ActionPlan`** y quitar campos
  clínicos; la lógica (`ApprovalStore`, `applyApprovalDecision`, ejecutar payload exacto) es agnóstica.
- `tools/button-actions.ts`, `dynamic-form.ts`, `wizard.ts`, `task-plan.ts`,
  `record-update.ts`, `open-record.ts` (interacciones genéricas).

**B.5 — Contexto y costo**
- `context-window.ts`, `context-breakdown.ts` (compactación/presupuesto), `usage-cost.ts`
  (costeo por precios del modelo), `model-preference.ts`.
- `persona.ts`: portar el **mecanismo** `composeLeadingLayers` (capas ordenadas de system-prompt)
  pero con el **texto como configuración/props**, no constantes de dominio.

**B.6 — (Opcional) Transcripción por voz**
- `core/audio-transcription/*` (Whisper en navegador con `@huggingface/transformers`,
  VAD, dictado). Genérico. Diferible a una fase posterior si no es prioritario.

**Verificación Fase B:**
- Tests unitarios portados (`contract-tools.test.ts`, `tool-runner.test.ts`, `agent-client.test.ts`).
- Test nuevo: `deriveResourceTools` sobre un catálogo de platform-core (p. ej. `users`)
  genera `resource.list_users`, `resource.get_users`, `resource.create_users`,
  `resource.update_users`, `resource.action_users_deactivate`, con `kind` correcto y
  `wireSchema` válido.

---

### FASE C — Shell del copiloto y auto-cableado

**C.1 — `CopilotPanel.tsx` parametrizado**
- Portar el orquestador extrayendo lo clínico a props: textos, sugerencias, persona,
  proveedores de contexto. El andamiaje (WS, streaming, aprobación, render de tool-calls,
  composer, costo, contexto, persistencia) es reutilizable tal cual.

**C.2 — Cableado automático con el contrato**
- Al montar el panel: `fetchResourceCatalog()` (versión browser) →
  `deriveResourceTools(catalog, { api: browserApi })` → merge con tools genéricas (ui.*, sandbox) →
  `effectiveTools` (gating por permisos de `/auth/me`) → `toWireToolDefinitions` → `turn.start`.
- Ejecución: al recibir `tool_call.ready`, `resolveToolCall` → si `read`, ejecuta con
  `browserApi` + builders (`buildListSearchParams`/detail) y reanuda; si `write`, construye
  `ActionPlan` (con `buildCreatePayload`/`buildUpdatePayload`/`actionBody`) → `awaiting_approval`.

**C.3 — Chat shell + rutas**
- Portar `chat-shell/*` (ChatShell, ChatNavProvider, `chat-persistence.ts`) — genérico salvo
  los comandos `/paciente`; dejar el sistema de comandos extensible y vacío de dominio.
- Ruta `src/app/(platform)/copilot/page.tsx` (copiloto full-screen) y, opcionalmente,
  el modo embebido (record panel) reusando `ResourceTableViewport` ya presente.
- Persistencia de conversaciones: modelo backend `Conversation` + endpoints
  (`api/v1/conversations.py`) si se quiere historial (puede diferirse; v1 puede ser efímero).

**C.4 — Aprobación de escrituras (UI)**
- `ToolCallCard`: badge Lectura/Escritura, estado, y para writes el plan canónico
  ("Datos exactos que se enviarán") + botones Aprobar/Rechazar. Al aprobar, ejecutar el
  `exactPayload` (no los args del modelo) y reanudar el turn.

**Verificación Fase C (end-to-end):**
- Con provider real (o `fake` extendido), pedir al copiloto "lista los últimos 5 usuarios":
  el modelo invoca `resource.list_users`, se ejecuta con la cookie, se revalida RBAC, responde.
- Pedir "desactiva al usuario X": genera `awaiting_approval`; al aprobar, ejecuta
  `action_users_deactivate` y confirma. Sin aprobar, no se muta nada.
- Verificar que un usuario **sin** `users:update` no recibe la tool de escritura (gating).

---

## 4. RBAC nuevo requerido

- Nuevo `SecurityGroup` para credenciales de IA, p. ej. `AiProviderPermissions`
  (`ai_providers:read|create|update|delete`) en `backend/app/security/groups/`.
- Declarar `ai_provider_credentials` como recurso en RESOURCE_REGISTRY (para gestionarlo
  desde el propio motor genérico), o como router dedicado si se prefiere ocultarlo del catálogo.
- Decisión: ¿el copiloto en sí requiere un permiso (`agent:use`)? Recomendado sí, para poder
  desactivarlo por rol. El endpoint `/connection-ticket` lo exigiría.

---

## 5. Mapeo contrato → tools (el corazón del auto-cableado)

`deriveResourceTools` recorre cada `ResourceCapability` del catálogo y emite:

| Tool derivada | Fuente en el contrato | `kind` | Ejecución |
| --- | --- | --- | --- |
| `resource.list_<r>` | `list.filterable_fields[].operators[].parameter_name`, `sort`, `pagination`, `search` | read | `buildListSearchParams` + `GET api_path` |
| `resource.get_<r>` | `detail`, `item_reference` (token `{id}`) | read | `GET detail.url_template` |
| `resource.create_<r>` | `forms.create.fields` (name/type/required/widget/options) → JSON Schema | write | `buildCreatePayload` + `POST api_path` |
| `resource.update_<r>` | `forms.update.fields` | write | `buildUpdatePayload` + `PATCH api_path/{id}` |
| `resource.action_<r>_<a>` | `actions[]` (method, url_template, `input_schema`/`fixed_body`, confirmation, visible/enabled_when) | write | `resolveActionUrl` + `actionBody` |
| `resource.relate_<r>_<rel>` | `relations[]` (URLs, request_field, options source) | write | editor M2M atómico |

Claves del mapeo (todo ya presente en el contrato de platform-core):

- Los **tipos de valor** son enums cerrados (`FieldValueType`: string/email/uuid/integer/
  decimal/boolean/date/time/datetime/enum/array) → traducibles casi 1:1 a JSON Schema.
- Los **parámetros de filtro** vienen con su `parameter_name` HTTP exacto (derivado del
  `CompiledQueryPlan`), así que el modelo genera queries válidas sin inferir sufijos.
- El **RBAC ya viene aplicado**: si una capability no está en el catálogo del usuario, su tool
  no se genera. Nada extra que gatear en el agente (defensa en profundidad: además,
  FastAPI revalida en la ejecución).
- Los nombres con namespace (`resource.list_users`) se **sanean al cable** (`.`→`_`, ≤64,
  `^[a-zA-Z0-9_-]{1,64}$`) y se revierten al emitir la tool-call — mecanismo ya en
  `model-gateway/src/kernel/tool-names.ts`.

**Precedencia:** si en el futuro platform-core añade tools hand-written para un
`(recurso, operación)`, la derivada correspondiente se omite (patrón `claimedWrites`/`claimsRead`).

---

## 6. Riesgos y decisiones abiertas

1. **Versión de Node del gateway** (`>=22`) vs frontend platform-core (`>=24`): coexisten,
   pero son toolchains distintos en el monorepo. Documentar como intencional.
2. **Estado del gateway MG-001 (in-memory):** los turns no sobreviven a reinicios y el único
   provider real hay que cablearlo (OpenAI/Anthropic/etc.). Para v1 basta un provider real +
   `fake` para tests. Persistencia de turns es fuera de alcance.
3. **Persistencia de conversaciones:** decidir si v1 es efímera (más simple) o con historial
   (requiere modelo + endpoints). Recomendado: efímera en v1, historial en fase posterior.
4. **OAuth de proveedor:** diferible; v1 con API keys cifradas basta.
5. **Política de retro-port:** como platform-core es la base de MedicoPilot, tras estabilizar,
   MedicoPilot debería **rebasar** su copiloto sobre el genérico de platform-core para no
   divergir (hoy el código genérico vive en el fork; el objetivo es invertir la dependencia).
6. **Superficie de escritura del agente:** con lectura+escritura, un modelo podría proponer
   muchas mutaciones. Mitigado por: aprobación obligatoria por escritura, payload exacto,
   y RBAC. Considerar un tope de writes por turn y/o marcar acciones `danger` con doble confirmación.

---

## 7. Entregables por fase (checklist)

- [x] **A** — `model-gateway/` operativo en compose/nginx; tickets + credential-lease;
      migración `AiProviderCredential`; turn `fake` end-to-end verde (262 tests Vitest;
      suite canónica backend 425 verde). *Diferido:* OAuth de proveedor (lease OAuth → 501).
- [x] **B** — `core/agent/**` portado y testeado; `deriveResourceTools` genera tools desde
      el contrato de platform-core (test sobre `users`; `npm run test:agent` 55 verde).
- [x] **C** — `CopilotPanel` + ruta `/copilot` + nginx dev same-origin; auto-cableado
      catálogo→tools→wire; lectura ejecuta, escritura pide aprobación (plan canónico).
      *Sin e2e todavía* (verificado con typecheck + lint + tests + build prod).
- [ ] **Docs** — actualizar `CLAUDE.md` y `docs/architecture/decisions.md` con la decisión.
- [ ] **Retro-port** (posterior) — plan para que MedicoPilot consuma el genérico.

## 9. Estado de implementación y brechas (revisión 2026-07-11)

Implementado y verificado: ver checklist §7. Brechas conocidas, por prioridad:

**Alta — CERRADAS (2026-07-11):**
1. ~~Test del lease~~ → `test_agent_internal_lease.py` portado (8 tests, incl. auditoría
   sin secreto) y en la suite canónica (433 verde).
2. ~~Bring-up real~~ → stack dev levantado con Docker; migraciones + bootstrap aplicados;
   verificado EN NAVEGADOR en `http://localhost:8080/copilot`: conexión (ticket→session→WS),
   34 tools derivadas del contrato, turno `fake` completo con round-trip de tool-call
   (tool_call.ready → ejecución en navegador → tool_result → resume → completed). Consola
   sin errores. Se añadió un bypass de lease para el provider `fake` en
   `http-control-plane.client.ts` (dev-only; sin efecto sin `GATEWAY_FAKE_ENABLED`), y
   `APP_ENCRYPTION_KEY` de desarrollo al ancla de `compose.dev.yml` (el cifrado fail-closed
   bloqueaba el alta de credenciales).
3. ~~UI de credenciales~~ → sección "Proveedores de IA" en `/account`
   (`AiProvidersPanel.tsx` + `ai-providers-client.ts`): alta/activar/desactivar/eliminar
   verificadas en vivo contra el backend (cifrado en reposo). Para un proveedor real solo
   falta habilitar su flag `GATEWAY_<PROVIDER>_ENABLED` y registrar la API key.

**Media (funcionalidad diferida a próximas rebanadas):**
4. Tests genéricos de `tool-catalog`/`tool-discovery`/`tool-notes`/`sandbox`/`tool-runner`
   (los de MedicoPilot estaban acoplados a tools clínicas y se descartaron; reescribir
   versiones genéricas).
5. Panel: compactación de contexto no cableada (se envía todo el historial; los módulos
   `context-window`/`context-breakdown` están portados pero sin usar), sin indicador de
   uso/costo en UI (`usage-cost` portado sin usar), sin render Markdown (texto plano),
   sin sugerencias de inicio cableadas (`start-suggestions` portado sin usar).
6. `ui.open_resource_form` / `InlineResourceForm` (formulario de recurso embebido en el
   chat con buscadores de relación): el spec `resource_form` cae a un enlace a
   `/resources/<name>`.
7. Builders de UI elaborados no portados: `button-actions` (gobernanza de botones tool),
   `dynamic-form`, `wizard`, `task-plan`, `record-update`, `open-record`.
8. Persistencia de conversaciones (v1 efímera, por diseño §6.3) y persona editable en UI.
9. Permiso `agent:use` (§4) sin crear: cualquier usuario autenticado puede pedir ticket.
10. MCP client y transcripción de voz (B.6) no portados.

**Baja:**
11. `compose.e2e.yml` no incluye el gateway (no hay e2e del copiloto aún).
12. `deriveTitle` del shell no conoce `/copilot` (título del header genérico en esa ruta).
13. OAuth de proveedor (ChatGPT/Codex): rama 501 en el lease; `agent/oauth.py` sin portar.
14. Retro-port a MedicoPilot (invertir la dependencia) sin planificar.

---

## 8. Estimación cualitativa

- Fase A: media (copia + backend de conexión + infra). El grueso es cableado, no lógica nueva.
- Fase B: media-alta (port de ~15-20 módulos genéricos + adaptar tipos al contrato de platform-core).
- Fase C: alta (el `CopilotPanel` es grande; el refactor a props parametrizables es el mayor esfuerzo).

Total: trabajo de varios días con tests. Se recomienda ejecutar y validar fase por fase antes de avanzar.
