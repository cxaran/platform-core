# Capa agéntica (copiloto)

Cómo está construido el copiloto de IA de Platform Core: un chat cuyo conjunto de
herramientas se **deriva del contrato de recursos** y respeta el RBAC existente, sin que
ningún dato del negocio pase por el proveedor de IA.

## Principio rector: tres autoridades separadas

La seguridad del copiloto descansa en separar tres responsabilidades que nunca se mezclan:

| Autoridad | Quién | Qué hace | Qué nunca hace |
| --- | --- | --- | --- |
| **Datos + RBAC** | FastAPI (backend) | Sirve datos, revalida permisos en cada endpoint, custodia credenciales del proveedor cifradas | No almacena credenciales del proveedor en claro |
| **Runtime de IA** | `model-gateway` (servicio TS) | Autoriza el turn, arrienda la credencial, negocia capacidades del modelo, normaliza eventos, **relaya** tool-calls al navegador | No ve datos del negocio; no ejecuta tools |
| **Ejecución de tools** | El navegador del usuario | Ejecuta cada tool contra la REST con la **cookie de sesión** | No tiene identidad propia |

De ahí las invariantes que ningún cambio debe romper:

1. El gateway relaya, no ejecuta tools ni orquesta. Los datos del negocio nunca lo
   atraviesan.
2. Toda tool se ejecuta en el navegador con la cookie del usuario, y FastAPI revalida
   permisos en cada endpoint: **el agente no puede hacer nada que el usuario no pueda**.
3. El catálogo de tools se **deriva** del contrato ya filtrado por RBAC; no se declara a
   mano.
4. Toda tool de **escritura** (`create`/`update`/`action`/`relation`) queda a la espera de
   aprobación explícita; se ejecuta el **payload exacto aprobado**, no los argumentos
   crudos del modelo, y ese payload sensible nunca sale del navegador hacia el gateway.
5. Las credenciales del proveedor se **arriendan por turn**, cifradas en reposo con Fernet.

## Flujo de una conexión

```
Navegador (usuario con sesión)
  │ 1. POST /api/v1/agent/connection-ticket           (cookie de sesión)
  │    ◄── ticket JWT (aud=agent-gateway, atado a la versión de sesión)
  │ 2. POST {gw}/v1/browser-sessions {ticket}         → crea sesión de navegador
  │ 3. WS  {gw}/v1/ws  → turn.start {messages, tools, model}
  ▼
model-gateway
  │ autoriza el turn · re-valida la sesión contra /api/v1/auth/me
  │ arrienda la credencial: POST /api/v1/internal/agent/credential-lease (X-Internal-Auth)
  │ ── startTurn ──► proveedor (OpenAI / Anthropic / Gemini / OpenRouter / local / …)
  │ ◄── text.delta · tool_call.ready · usage
  ▼
Navegador  ── ejecuta la tool con la cookie ──►  FastAPI (revalida RBAC)
  │ lectura → ejecuta y reanuda el turn
  │ escritura → construye el plan canónico → espera aprobación → ejecuta el payload exacto
```

nginx sirve el gateway bajo el **mismo origen** que el frontend, en `/model-gateway/`,
para que el navegador reenvíe la cookie de sesión al abrir la conexión.

## Puente FastAPI ↔ Gateway

Dos únicos contactos entre backend y gateway, ambos sin exponer datos del negocio:

- **Ticket de conexión** (`app/agent/ticket.py`, `POST /api/v1/agent/connection-ticket`):
  JWT HS256 con `aud=agent-gateway`, `sub` = id de usuario y `sid` = versión de token de la
  sesión. Rotar la sesión invalida los tickets al instante. El gateway lo verifica con el
  secreto compartido (`AGENT_GATEWAY_TICKET_SECRET` ↔ `GATEWAY_AGENT_TICKET_SECRET`). Su TTL
  es **política editable** en Configuración del sistema.
- **Arriendo de credencial** (`app/api/v1/agent_internal.py`, `POST
  /api/v1/internal/agent/credential-lease`): server-to-server, autenticado con
  `X-Internal-Auth` comparado en tiempo constante. Devuelve el secreto del proveedor
  descifrado con vida corta (`AGENT_GATEWAY_LEASE_TTL_SECONDS`); se audita **sin** el
  secreto. Es un endpoint interno: no debe exponerse a la red pública.

Las credenciales de proveedor de IA se guardan **cifradas en reposo por usuario** (Fernet,
la misma clave maestra `APP_ENCRYPTION_KEY`) y se administran desde **Mi cuenta →
Proveedores de IA**. El gateway nunca las almacena: solo las arrienda por turn.

## Del contrato a las herramientas

El corazón del copiloto es que **no hay tools escritas a mano** para los recursos: se
derivan del catálogo que ya publica el contrato (`GET /api/v1/resources`, filtrado por los
permisos de la sesión). `deriveResourceTools` recorre cada capability y emite:

| Tool | Fuente en el contrato | Tipo |
| --- | --- | --- |
| `resource.list_<r>` | filtros/orden/paginación/búsqueda de la lista | lectura |
| `resource.get_<r>` | detalle + `item_reference` | lectura |
| `resource.create_<r>` | `forms.create` → JSON Schema | escritura |
| `resource.update_<r>` | `forms.update` | escritura |
| `resource.action_<r>_<a>` | `actions[]` | escritura |
| `resource.relate_<r>_<rel>` | `relations[]` | escritura |

Como el catálogo ya viene filtrado por RBAC, un usuario sin un permiso simplemente no
recibe la tool correspondiente (defensa en profundidad: además FastAPI revalida al
ejecutar). Los nombres con namespace (`resource.list_users`) se sanean al cable
(`^[a-zA-Z0-9_-]{1,64}$`, `kernel/tool-names.ts`) y se revierten al emitir la tool-call.

## El runtime `model-gateway`

Servicio TypeScript (Fastify) neutral respecto al proveedor. Detalle completo en su
[README](../../model-gateway/README.md); en resumen:

- **No es un agente**: no guarda memoria de negocio, no ejecuta tools, no planifica. Valida
  la sesión de navegador, autoriza el turn, arrienda la credencial, negocia capacidades del
  modelo, valida el presupuesto de contexto y relaya eventos por WebSocket.
- Sesiones y turns son **en memoria**: no sobreviven a un reinicio del proceso.
- Adaptadores de proveedor reales, cada uno opt-in por configuración: OpenAI (API key y
  ChatGPT/Codex por OAuth), Anthropic, Gemini, OpenRouter, opencode, local (Ollama/vLLM) y
  un proveedor `fake` para desarrollo/tests.
- Negociación de capacidades por modelo (tools, salida estructurada, esfuerzo de
  razonamiento, imagen) y presupuesto de contexto acotado.

## Ubicación en el código

| Pieza | Dónde |
| --- | --- |
| Ticket + OAuth de proveedor | `backend/app/agent/` |
| Endpoints (ticket, lease interno, credenciales) | `backend/app/api/v1/agent*.py` |
| Runtime del proveedor | `model-gateway/` |
| Framework agéntico del cliente | `frontend/src/core/agent/` |
| UI del copiloto | `frontend/src/components/copilot/`, ruta `/copilot` |

## Estado y límites conocidos

- Persistencia de conversaciones: **efímera** por diseño (el historial no se guarda entre
  sesiones).
- El copiloto no exige aún un permiso propio (`agent:use`): cualquier usuario autenticado
  puede solicitar ticket. Gatearlo por permiso es una extensión prevista.
- Compactación de contexto, indicador de costo, render Markdown y transcripción por voz
  están portados como módulos pero no todos cableados en el panel.
