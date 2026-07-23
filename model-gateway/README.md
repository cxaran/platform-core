# Model Gateway

A provider-neutral inference runtime for platform-core (MG-002).

This service is not an agent. It does not keep business memory, execute business tools, plan actions, or query business data. It validates a browser gateway session, authorizes the turn against the backend, leases the user's provider credential for the duration of the turn, negotiates model capabilities, validates the context budget, normalizes WebSocket events, and relays tool calls back to the browser (the browser executes every tool; the gateway never does).

## Current boundaries

- Browser sessions and active turns are in-memory; they do not survive a process restart.
- Provider credentials are **never stored** in the gateway: they arrive decrypted per turn via the backend lease bridge (see below) and live only for the duration of the turn.
- Rate limiting is a no-op adapter; there is no Redis or other external state.
- The `fake` provider is opt-in (`GATEWAY_FAKE_ENABLED=true`). It is also auto-registered when no backend is configured, because the fake control-plane used in that dev mode can only authorize the `fake` provider.

## Provider adapters

The registry wires real adapters, each behind opt-in settings (base URL + enable flag; see `.env.example`):

- **opencode Zen / opencode Go** (`providers/opencode/`) — OpenAI-compatible wire, provider ids `opencode_zen` / `opencode_go`. Poor `/models` metadata is filled from a curated map (provider data always wins).
- **OpenAI** (`providers/openai/`) — two auth shapes under one adapter: `openai` (API key, `chat_completions` against api.openai.com) and `openai_codex` (ChatGPT subscription via OAuth, Codex `/responses` app-server wire). Both can be enabled at once; the lease bridge resolves the right credential type for each.
- **OpenRouter** (`providers/openrouter/`) — OpenAI-compatible wire with rich `/models` discovery (real capability metadata and pricing).
- **Anthropic** (`providers/anthropic/`) — Messages API (a distinct wire family: top-level `system`, typed content blocks, extended thinking by token budget).
- **Google Gemini** (`providers/gemini/`) — Generative Language API (`streamGenerateContent`, `systemInstruction`, function calling correlated by name).
- **Local / on-prem** (`providers/local/`) — Ollama / vLLM through their OpenAI-compatible endpoints; usually no API key (an empty lease is valid), and no data leaves the host.
- **Fake** (`providers/fake/`) — synthetic dev/test provider, opt-in as described above.

OpenAI-compatible adapters share the wire core in `providers/openai-compat/chat.ts` (request build, SSE streaming, tool-call relay, parallel tool-call draining). Tool names are sanitized for strict wires (`^[a-zA-Z0-9_-]{1,64}$`, canonical helper in `kernel/tool-names.ts`) and reverted to the original namespaced name (`resource.*`, `ui.*`) when the tool call is emitted to the browser.

## Connection ticket

`POST {prefix}/v1/browser-sessions` resolves the request `ticket` in this order:

1. **FastAPI JWT (primary path).** If `GATEWAY_AGENT_TICKET_SECRET` is set, the ticket is verified as the HS256 JWT issued by FastAPI's `POST /api/v1/agent/connection-ticket` (the secret must match the backend's `AGENT_GATEWAY_TICKET_SECRET`). Verification checks the signature, `aud=agent-gateway` and expiry, then propagates the identity (`sub` -> `userId`, `sid` -> `sessionRef`) onto the browser session.
2. **Dev ticket (fallback, non-production only).** Outside `NODE_ENV=production`, a body ticket equal to `GATEWAY_DEV_TICKET` still creates a development session.

An invalid signature, wrong audience, or expired ticket yields `401 INVALID_TICKET`. The ticket and the shared secret are never logged. In addition, when a backend is configured, each turn re-validates the user's backend session cookie against `/api/v1/auth/me` before running — FastAPI remains the data authority.

## Credential lease bridge (B4)

FastAPI owns AI provider credentials, encrypted at rest per user. The gateway does **not** store them: it leases a decrypted secret short-lived, only for the duration of a turn.

- When both `GATEWAY_BACKEND_INTERNAL_URL` and `GATEWAY_BACKEND_INTERNAL_SECRET` are set, the container wires `HttpControlPlaneClient`. Its `leaseCredential` does a server-to-server `POST {GATEWAY_BACKEND_INTERNAL_URL}/api/v1/internal/agent/credential-lease` with header `X-Internal-Auth: {GATEWAY_BACKEND_INTERNAL_SECRET}` (must match the backend's `AGENT_GATEWAY_INTERNAL_SECRET`) and body `{ user_id, provider, credential_type? }`. The `user_id` comes from the browser-session identity propagated by the connection ticket; the provider from the turn authorization (`openai` vs `openai_codex` map to the same backend provider with different credential types).
- The backend returns `{ lease_id, secret, expires_at, account_id?, default_model? }` where `secret` is the decrypted API key or refreshed OAuth access token (short TTL via `AGENT_GATEWAY_LEASE_TTL_SECONDS`). The client maps it to a `ProviderCredentialLease` and never logs the secret. Errors expose only the HTTP status, never the response body or the internal secret.
- When the backend config is absent, the fake control-plane (`fake-secret`) is used so dev and tests keep working — together with the auto-registered fake provider.
- The backend endpoint is internal-only (server-to-server secret, not cookie auth); deployments must keep it off the public network.
- Turn usage reporting (`reportTurnUsage`) is wired from the turn use cases (non-fatal on error), but the backend does not expose a usage endpoint yet, so the HTTP client is a documented no-op for now.

## Capability negotiation and discovery

Capability negotiation is implemented (`application/capabilities/`): the model's capabilities come from live provider discovery (`/models` with the user's leased credential, falling back to the curated catalog), and the negotiator gates tools, structured output, reasoning effort, and image input per model and per policy. The context budgeter bounds the estimated input against the smallest of the model's native context window, the profile limit, and the gateway global cap. `effective_context_tokens` exists in the wire shape as a seam for account-level caps but is currently always `null` (no adapter populates it yet).

## WebSocket protocol (B6)

Over the same authenticated WebSocket as the turn flow, the gateway exposes catalog RPCs and control verbs (catalog over the same WS, no separate REST). The turn flow is `turn.start` / `turn.tool_result` → `turn.started` / `turn.text.delta` / `turn.reasoning.summary` / `turn.tool_call.ready` / `turn.completed` / `turn.failed`.

Client → gateway:

- `models.list` `{ request_id, view?: "default" }` — read-only. Replies `models.list.result` `{ request_id, view, models }`, where each model is the catalog descriptor in wire shape (snake_case) with the enriched capabilities (native `context_window_tokens` vs `effective_context_tokens`, `compat` flags, modality arrays, pricing when known). No credentials are exposed.
- `provider.status` `{ request_id }` — read-only. Replies `provider.status.result` `{ request_id, providers }` listing the provider protocols registered gateway-side with `available` reflecting gateway config. It does **not** read user credentials — the frontend queries those against FastAPI `/users/me/ai-providers`.
- `agent.cancel_turn` `{ request_id, turn_id? }` — cancels an in-flight turn of the current browser session (transitions to `cancelled` via the state machine, clears pending tool calls). If `turn_id` is omitted, cancels the session's active turn(s). Emits `turn.cancelled` `{ turn_id }` per cancelled turn and replies `agent.cancel_turn.result` `{ request_id, cancelled_turn_ids }`. On failure replies `rpc.error` `{ request_id, code, message }`.

Streaming snapshot: `turn.text.delta` also carries a `snapshot` field — the accumulated assistant text for the current streaming segment — so a reconnecting client can resync without replaying every delta. The snapshot resets per streaming segment.

## Routing

- The canonical public prefix is configured by `GATEWAY_PUBLIC_PATH_PREFIX`, defaulting to `/model-gateway`.
- `GATEWAY_ENABLE_ROOT_PATH_ALIAS=true` enables a temporary alias for `/v1/*` to support direct local/container tests.
- Production routing should use the canonical prefixed path only.

## Observability

- `/metrics` is an internal observability endpoint for Prometheus scraping.
- Production ingress must not expose `/metrics` publicly.

## Protocol Limits

- `GATEWAY_MAX_WS_MESSAGE_BYTES` limits incoming WebSocket message size.
- `GATEWAY_MAX_TOOLS_PER_TURN` limits declared tools per turn.
- `GATEWAY_MAX_TOOL_RESULT_BYTES` limits browser-supplied tool results.
- `GATEWAY_TOOL_RESULT_TIMEOUT_MS` expires turns waiting for tool results.

## Logging

Application logs must not include prompts, tool results, cookies, authorization headers, API keys, or full tool arguments (`kernel/redact.ts`).
