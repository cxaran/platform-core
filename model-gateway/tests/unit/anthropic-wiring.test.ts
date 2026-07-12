import { describe, expect, it } from "vitest";
import { StartTurn } from "../../src/application/turns/start-turn.js";
import { ResumeTurnAfterTool } from "../../src/application/turns/resume-turn-after-tool.js";
import { ModelDiscoveryService } from "../../src/application/capabilities/model-discovery.js";
import { ProviderRegistry } from "../../src/providers/registry.js";
import { AnthropicProviderAdapter, createAnthropicModel } from "../../src/providers/anthropic/adapter.js";
import { InMemoryModelCatalog } from "../../src/infrastructure/catalog/in-memory-model-catalog.js";
import { InMemoryTurnStore } from "../../src/infrastructure/turn-store/in-memory-turn-store.js";
import { NoopRateLimiter } from "../../src/infrastructure/rate-limit/noop-rate-limiter.js";
import type { TurnEvent, TurnEventSink } from "../../src/application/turns/start-turn.js";
import type { StartTurnRequest } from "../../src/application/capabilities/request-normalizer.js";
import type { GatewaySettings } from "../../src/config/settings.js";
import type { TelemetryPort } from "../../src/ports/telemetry.port.js";
import type { BrowserSession } from "../../src/domain/gateway-session.js";
import type { ControlPlanePort, TurnAuthorization } from "../../src/ports/control-plane.port.js";
import type { ProviderCredentialLease } from "../../src/ports/provider-adapter.port.js";
import type { ModelToolDefinition } from "../../src/domain/tool.js";

/**
 * Wiring end-to-end del adaptador Anthropic SIN Anthropic real: control-plane que resuelve el
 * perfil "anthropic", arriendo de credencial, StartTurn -> stream (Messages API) -> relay de
 * tool -> ResumeTurnAfterTool. El proveedor se mockea con un fetch en cola (SSE Anthropic).
 */

const BASE_URL = "https://anthropic.test/v1";
const MODEL_ID = "claude-sonnet-4-5";

const settings: GatewaySettings = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 0,
  publicPathPrefix: "/model-gateway",
  enableRootPathAlias: true,
  cookieName: "mg_session",
  allowedOrigins: ["http://localhost:3000"],
  globalMaxContextTokens: 128000,
  safetyReserveTokens: 1024,
  maxWebSocketMessageBytes: 1024 * 1024,
  maxToolsPerTurn: 16,
  maxToolResultBytes: 64 * 1024,
  toolResultTimeoutMs: 60000,
  devTicket: "test-ticket",
  agentTicketSecret: "",
  opencodeBaseUrl: "https://opencode.test/v1",
  opencodeDefaultModel: "test-model"
};

// Control-plane que enruta al proveedor "anthropic" y arrienda un x-api-key (la API key real
// descifrada del usuario). Habilita la capacidad reasoning para validar el mapeo a thinking.
class AnthropicControlPlane implements ControlPlanePort {
  leasedSecrets: string[] = [];
  async authorizeTurn(input: { browserSessionId: string; profileId: string }): Promise<TurnAuthorization> {
    return {
      userId: "user_test",
      sessionId: input.browserSessionId,
      tenantId: null,
      profileId: input.profileId,
      providerId: "anthropic",
      credentialId: "user_test",
      modelId: MODEL_ID,
      allowedCapabilities: { tools: true, structuredOutput: true, reasoning: true, images: false, audio: false },
      limits: {
        maxConcurrentTurns: 2,
        maxInputTokens: null,
        maxOutputTokens: 4096,
        maxTurnDurationSeconds: 60,
        maxToolResultBytes: 64 * 1024
      }
    };
  }
  async leaseCredential(): Promise<ProviderCredentialLease> {
    const secret = "leased-anthropic-key";
    this.leasedSecrets.push(secret);
    return { leaseId: "lease-1", secret, expiresAt: new Date(Date.now() + 60_000) };
  }
  async leaseCredentialForProvider(): Promise<ProviderCredentialLease | null> {
    return null;
  }
  async releaseCredentialLease(): Promise<void> {}
  async reportTurnUsage(): Promise<void> {}
}

function telemetry(): TelemetryPort {
  return { info() {}, warn() {}, error() {} };
}

// Construye una respuesta SSE de la Messages API: cada evento es `event: <type>\ndata: <json>`.
function sseResponse(events: Array<Record<string, unknown>>): Response {
  const body =
    events
      .map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
      .join("") + "";
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    }
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function textTurnEvents(text: string): Array<Record<string, unknown>> {
  return [
    { type: "message_start", message: { usage: { input_tokens: 10 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } },
    { type: "message_stop" }
  ];
}

function toolUseTurnEvents(name: string): Array<Record<string, unknown>> {
  return [
    { type: "message_start", message: { usage: { input_tokens: 12 } } },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 3 } },
    { type: "message_stop" }
  ];
}

function createSink(): TurnEventSink & { events: TurnEvent[] } {
  const events: TurnEvent[] = [];
  return { events, async emit(event) { events.push(event); } };
}

function browserSession(): BrowserSession {
  return {
    id: "bs_test",
    userId: "user_test",
    sessionRef: "session_test",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000)
  };
}

function startRequest(overrides: Partial<StartTurnRequest> = {}): StartTurnRequest {
  return {
    requestId: "req_1",
    profileId: `anthropic/${MODEL_ID}`,
    messages: [{ role: "user", content: [{ type: "text", text: "Hola" }] }],
    tools: [],
    generation: { maxOutputTokens: 100 },
    ...overrides
  };
}

function setup(responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const queue = [...responses];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = queue.shift();
    if (!next) {
      throw new Error("fetch mock: sin respuestas en cola");
    }
    return next;
  }) as unknown as typeof fetch;

  const adapter = new AnthropicProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
  const providerRegistry = new ProviderRegistry([adapter]);
  const modelCatalog = new InMemoryModelCatalog([createAnthropicModel({ baseUrl: BASE_URL, modelId: MODEL_ID })]);
  const controlPlane = new AnthropicControlPlane();
  const tel = telemetry();
  const modelDiscovery = new ModelDiscoveryService({
    controlPlane,
    providerRegistry,
    modelCatalog,
    telemetry: tel,
    discoverableProviderIds: []
  });
  const turnStore = new InMemoryTurnStore();
  const startTurn = new StartTurn({
    controlPlane,
    modelCatalog,
    modelDiscovery,
    providerRegistry,
    turnStore,
    limiter: new NoopRateLimiter(),
    telemetry: tel,
    settings
  });
  const resume = new ResumeTurnAfterTool({
    turnStore,
    modelCatalog,
    providerRegistry,
    controlPlane,
    telemetry: tel,
    settings
  });
  return { startTurn, resume, turnStore, controlPlane, calls };
}

const toolDef: ModelToolDefinition = {
  name: "example.list_patients",
  description: "Lista registros",
  inputSchema: { type: "object", additionalProperties: false },
  strict: false
};

function types(events: TurnEvent[]): string[] {
  return events.map((e) => e.type);
}

describe("wiring Anthropic (StartTurn -> lease -> adapter -> stream -> resume)", () => {
  it("resuelve el perfil anthropic, arrienda y completa un turno de texto", async () => {
    const { startTurn, turnStore, controlPlane, calls } = setup([sseResponse(textTurnEvents("Hola doctor"))]);
    const sink = createSink();
    await startTurn.execute(browserSession(), startRequest(), sink);

    expect(types(sink.events)).toContain("turn.started");
    expect(types(sink.events)).toContain("turn.completed");
    // Se arrendó la key y se usó x-api-key + anthropic-version contra /messages (no Bearer).
    expect(controlPlane.leasedSecrets).toEqual(["leased-anthropic-key"]);
    expect(calls[0]?.url).toBe(`${BASE_URL}/messages`);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("leased-anthropic-key");
    expect(headers["anthropic-version"]).toBeDefined();
    expect(headers.authorization).toBeUndefined();

    const started = sink.events.find((e) => e.type === "turn.started");
    const turnId = started && "turn_id" in started ? started.turn_id : "";
    expect((await turnStore.get(turnId))?.status).toBe("completed");
  });

  it("acumula los text_delta en el snapshot", async () => {
    const { startTurn } = setup([
      sseResponse([
        { type: "message_start", message: { usage: { input_tokens: 4 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hola " } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "doctor" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
        { type: "message_stop" }
      ])
    ]);
    const sink = createSink();
    await startTurn.execute(browserSession(), startRequest(), sink);
    const deltas = sink.events.filter((e) => e.type === "turn.text.delta");
    const last = deltas[deltas.length - 1];
    expect(last && "snapshot" in last ? last.snapshot : "").toBe("Hola doctor");
  });

  it("relay de tool: waiting_for_tool tras el tool_use y completa al reanudar", async () => {
    const { startTurn, resume, turnStore } = setup([
      sseResponse(toolUseTurnEvents("example.list_patients")),
      sseResponse(textTurnEvents("Listo"))
    ]);
    const startSink = createSink();
    await startTurn.execute(browserSession(), startRequest({ tools: [toolDef] }), startSink);
    const toolCall = startSink.events.find((e) => e.type === "turn.tool_call.ready");
    if (!toolCall || toolCall.type !== "turn.tool_call.ready") {
      throw new Error("esperado turn.tool_call.ready");
    }
    expect(toolCall.tool_name).toBe("example.list_patients");
    expect((await turnStore.get(toolCall.turn_id))?.status).toBe("waiting_for_tool");

    const resumeSink = createSink();
    await resume.execute(
      toolCall.turn_id,
      { callId: toolCall.call_id, result: { status: "success", content: { items: [] } } },
      resumeSink
    );
    expect(types(resumeSink.events)).toContain("turn.completed");
    expect((await turnStore.get(toolCall.turn_id))?.status).toBe("completed");
  });

  it("al reanudar envía un mensaje user con bloque tool_result correlacionado", async () => {
    const { startTurn, resume, calls } = setup([
      sseResponse(toolUseTurnEvents("example.list_patients")),
      sseResponse(textTurnEvents("Listo"))
    ]);
    const startSink = createSink();
    await startTurn.execute(browserSession(), startRequest({ tools: [toolDef] }), startSink);
    const toolCall = startSink.events.find((e) => e.type === "turn.tool_call.ready");
    if (!toolCall || toolCall.type !== "turn.tool_call.ready") {
      throw new Error("esperado turn.tool_call.ready");
    }
    await resume.execute(
      toolCall.turn_id,
      { callId: toolCall.call_id, result: { status: "success", content: { ok: true } } },
      createSink()
    );
    // Segunda llamada = resume. El último mensaje debe ser user con un tool_result al toolu_1.
    const resumeBody = JSON.parse(String(calls[1]?.init.body ?? "{}")) as {
      messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
    };
    const last = resumeBody.messages[resumeBody.messages.length - 1];
    expect(last?.role).toBe("user");
    expect(last?.content[0]?.type).toBe("tool_result");
    expect(last?.content[0]?.tool_use_id).toBe("toolu_1");
    // La asistente intermedia debe re-enviar el bloque tool_use (round-trip 1:1).
    const assistant = resumeBody.messages.find((m) => m.role === "assistant");
    expect(assistant?.content.some((b) => b.type === "tool_use")).toBe(true);
  });
});

describe("Anthropic: mapeo del campo system (top-level) y messages", () => {
  async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
    for await (const _ of iterable) {
      void _;
    }
  }
  function captureBody(responses: Response[]) {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const queue = [...responses];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
      return queue.shift() ?? sseResponse([{ type: "message_stop" }]);
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }
  const credential = { leaseId: "l1", secret: "k", expiresAt: new Date(Date.now() + 60_000) };

  it("los mensajes system se concatenan en el campo system; messages solo lleva user/assistant", async () => {
    const { calls, fetchImpl } = captureBody([sseResponse(textTurnEvents("ok"))]);
    const adapter = new AnthropicProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
    const model = createAnthropicModel({ baseUrl: BASE_URL, modelId: MODEL_ID });
    await drain(
      adapter.startTurn({
        turnId: "t1",
        model,
        credential,
        messages: [
          { role: "system", content: [{ type: "text", text: "CAPA DE SEGURIDAD" }] },
          { role: "system", content: [{ type: "text", text: "PERSONA: formal" }] },
          { role: "user", content: [{ type: "text", text: "Hola" }] }
        ],
        tools: [],
        options: { maxOutputTokens: 100 },
        signal: new AbortController().signal
      })
    );
    expect(calls[0]?.body.system).toBe("CAPA DE SEGURIDAD\n\nPERSONA: formal");
    const messages = calls[0]?.body.messages as Array<{ role: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
  });
});

describe("Anthropic: mapeo de reasoning normalizado -> extended thinking (presupuesto)", () => {
  async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
    for await (const _ of iterable) {
      void _;
    }
  }
  function captureBody() {
    const calls: { body: Record<string, unknown> }[] = [];
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body ?? "{}")) });
      return sseResponse([{ type: "message_stop" }]);
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }
  const credential = { leaseId: "l1", secret: "k", expiresAt: new Date(Date.now() + 60_000) };
  const messages = [{ role: "user" as const, content: [{ type: "text" as const, text: "Hola" }] }];

  it("'max' habilita thinking con budget 32768 y amplía max_tokens (sin temperature)", async () => {
    const { calls, fetchImpl } = captureBody();
    const adapter = new AnthropicProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
    const model = createAnthropicModel({ baseUrl: BASE_URL, modelId: MODEL_ID });
    expect(model.capabilities.compat.supportsReasoningEffort).toBe(true);
    await drain(
      adapter.startTurn({
        turnId: "t1",
        model,
        credential,
        messages,
        tools: [],
        options: { maxOutputTokens: 1024, reasoningEffort: "max", temperature: 0.7 },
        signal: new AbortController().signal
      })
    );
    expect(calls[0]?.body.thinking).toEqual({ type: "enabled", budget_tokens: 32768 });
    expect(calls[0]?.body.max_tokens).toBe(1024 + 32768);
    expect(calls[0]?.body.temperature).toBeUndefined();
  });

  it("'low' usa budget 2048", async () => {
    const { calls, fetchImpl } = captureBody();
    const adapter = new AnthropicProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
    const model = createAnthropicModel({ baseUrl: BASE_URL, modelId: MODEL_ID });
    await drain(
      adapter.startTurn({
        turnId: "t1",
        model,
        credential,
        messages,
        tools: [],
        options: { maxOutputTokens: 1024, reasoningEffort: "low" },
        signal: new AbortController().signal
      })
    );
    expect(calls[0]?.body.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
  });

  it("'off' omite thinking y conserva temperature", async () => {
    const { calls, fetchImpl } = captureBody();
    const adapter = new AnthropicProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
    const model = createAnthropicModel({ baseUrl: BASE_URL, modelId: MODEL_ID });
    await drain(
      adapter.startTurn({
        turnId: "t1",
        model,
        credential,
        messages,
        tools: [],
        options: { maxOutputTokens: 1024, reasoningEffort: "off", temperature: 0.3 },
        signal: new AbortController().signal
      })
    );
    expect(calls[0]?.body.thinking).toBeUndefined();
    expect(calls[0]?.body.temperature).toBe(0.3);
    expect(calls[0]?.body.max_tokens).toBe(1024);
  });

  it("modelo sin thinking (claude-3-5-haiku) omite el parámetro aunque se pida 'high'", async () => {
    const { calls, fetchImpl } = captureBody();
    const adapter = new AnthropicProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
    const model = createAnthropicModel({ baseUrl: BASE_URL, modelId: "claude-3-5-haiku-20241022" });
    expect(model.capabilities.compat.supportsReasoningEffort).toBe(false);
    await drain(
      adapter.startTurn({
        turnId: "t1",
        model,
        credential,
        messages,
        tools: [],
        options: { maxOutputTokens: 1024, reasoningEffort: "high" },
        signal: new AbortController().signal
      })
    );
    expect(calls[0]?.body.thinking).toBeUndefined();
  });
});

describe("Anthropic: saneo de nombres de tool en el cable y reversión al emitir", () => {
  // Anthropic exige nombres ^[a-zA-Z0-9_-]{1,64}$: el punto de nuestros namespaces
  // ("example.list_patients") debe ir saneado en el cable y la tool call emitida al
  // navegador debe REVERTIR al nombre original (kernel/tool-names.ts).
  const WIRE_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

  async function collect(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
    const out: unknown[] = [];
    for await (const ev of iterable) {
      out.push(ev);
    }
    return out;
  }
  function fetchQueue(responses: Response[]) {
    const calls: { url: string; init: RequestInit }[] = [];
    const queue = [...responses];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return queue.shift() ?? sseResponse(textTurnEvents("ok"));
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }
  const credential = { leaseId: "l1", secret: "k", expiresAt: new Date(Date.now() + 60_000) };
  const messages = [{ role: "user" as const, content: [{ type: "text" as const, text: "Hola" }] }];
  const namespacedTools: ModelToolDefinition[] = [
    toolDef,
    { name: `ui.${"x".repeat(80)}`, description: "Larga", inputSchema: { type: "object" }, strict: false }
  ];

  it("declara tools saneadas (sin punto, tope 64) y revierte el nombre en tool_call.ready", async () => {
    const { calls, fetchImpl } = fetchQueue([
      // El proveedor emite el nombre SANEADO (es el que se le declaró).
      sseResponse(toolUseTurnEvents("example_list_patients"))
    ]);
    const adapter = new AnthropicProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
    const model = createAnthropicModel({ baseUrl: BASE_URL, modelId: MODEL_ID });
    const events = await collect(
      adapter.startTurn({
        turnId: "t1",
        model,
        credential,
        messages,
        tools: namespacedTools,
        options: { maxOutputTokens: 100 },
        signal: new AbortController().signal
      })
    );

    // Cable: todos los nombres declarados cumplen el patrón estricto de Anthropic.
    const body = JSON.parse(String(calls[0]?.init.body ?? "{}")) as { tools: Array<{ name: string }> };
    expect(body.tools[0]?.name).toBe("example_list_patients");
    for (const tool of body.tools) {
      expect(tool.name).toMatch(WIRE_NAME_PATTERN);
    }
    expect(body.tools[1]?.name.length).toBe(64);

    // Evento al navegador: el nombre ORIGINAL (con '.') que conoce el registro de tools.
    const ready = events.find(
      (e): e is { type: "tool_call.ready"; call: { name: string }; continuationState?: unknown } =>
        (e as { type?: string }).type === "tool_call.ready"
    );
    expect(ready?.call.name).toBe("example.list_patients");
  });

  it("al reanudar, el historial reenvía el tool_use con el nombre SANEADO que emitió el proveedor", async () => {
    const { calls, fetchImpl } = fetchQueue([
      sseResponse(toolUseTurnEvents("example_list_patients")),
      sseResponse(textTurnEvents("Listo"))
    ]);
    const adapter = new AnthropicProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
    const model = createAnthropicModel({ baseUrl: BASE_URL, modelId: MODEL_ID });
    const events = await collect(
      adapter.startTurn({
        turnId: "t1",
        model,
        credential,
        messages,
        tools: [toolDef],
        options: { maxOutputTokens: 100 },
        signal: new AbortController().signal
      })
    );
    const ready = events.find(
      (e): e is { type: string; call: { callId: string; name: string }; continuationState?: unknown } =>
        (e as { type?: string }).type === "tool_call.ready"
    );
    if (!ready) {
      throw new Error("esperado tool_call.ready");
    }
    await collect(
      adapter.resumeTurn({
        turnId: "t1",
        model,
        credential,
        toolResults: [{ callId: ready.call.callId, result: { status: "success", content: { ok: true } } }],
        continuationState: ready.continuationState ?? null,
        signal: new AbortController().signal
      })
    );
    const resumeBody = JSON.parse(String(calls[1]?.init.body ?? "{}")) as {
      tools: Array<{ name: string }>;
      messages: Array<{ role: string; content: Array<{ type: string; name?: string }> }>;
    };
    // Tools y tool_use del historial siguen SANEADOS en el cable del resume.
    expect(resumeBody.tools[0]?.name).toBe("example_list_patients");
    const assistant = resumeBody.messages.find((m) => m.role === "assistant");
    const toolUse = assistant?.content.find((b) => b.type === "tool_use");
    expect(toolUse?.name).toBe("example_list_patients");
  });
});

describe("Anthropic: discovery y resolución de capacidades", () => {
  it("discoverModels mapea /v1/models a descriptores honestos", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          data: [
            { type: "model", id: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5", created_at: "2025-09-29" },
            { type: "model", id: "claude-3-5-haiku-20241022", display_name: "Claude Haiku 3.5" }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as unknown as typeof fetch;
    const adapter = new AnthropicProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
    const models = await adapter.discoverModels({ leaseId: "l", secret: "k", expiresAt: new Date() });
    expect(models).toHaveLength(2);
    const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4-5");
    expect(sonnet?.route.protocol).toBe("anthropic_messages");
    expect(sonnet?.capabilities.compat.supportsReasoningEffort).toBe(true);
    expect(sonnet?.capabilities.compat.thinkingFormat).toBe("anthropic_thinking");
    expect(sonnet?.source).toBe("discovered");
  });

  it("createAnthropicModel: contexto documentado, visión y thinking por familia", () => {
    const sonnet = createAnthropicModel({ baseUrl: BASE_URL, modelId: "claude-sonnet-4-5" });
    expect(sonnet.capabilities.contextWindowTokens).toBe(200000);
    expect(sonnet.capabilities.inputModalities.has("image")).toBe(true);
    expect(sonnet.capabilities.reasoning.support).toBe("supported");
    expect(sonnet.capabilities.compat.supportsTools).toBe(true);

    const haiku = createAnthropicModel({ baseUrl: BASE_URL, modelId: "claude-3-5-haiku-20241022" });
    expect(haiku.capabilities.inputModalities.has("image")).toBe(false);
    expect(haiku.capabilities.reasoning.support).toBe("unknown");
    expect(haiku.capabilities.compat.supportsReasoningEffort).toBe(false);
  });

  it("discoverModels lanza PROVIDER_DISCOVERY_FAILED si /v1/models falla", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const adapter = new AnthropicProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
    await expect(adapter.discoverModels({ leaseId: "l", secret: "k", expiresAt: new Date() })).rejects.toThrow();
  });
});

describe("Anthropic: mapeo de usage con split cache read/write (P7)", () => {
  it("reporta cachedInputTokens (read) y cacheWriteTokens (creation) del evento completed", async () => {
    // message_start trae input_tokens + cache_read + cache_creation; message_delta trae output.
    const events: Array<Record<string, unknown>> = [
      {
        type: "message_start",
        message: {
          usage: { input_tokens: 30, cache_read_input_tokens: 12, cache_creation_input_tokens: 7 }
        }
      },
      { type: "content_block_start", index: 0, content_block: { type: "text" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 9 } },
      { type: "message_stop" }
    ];
    const { startTurn } = setup([sseResponse(events)]);
    const sink = createSink();
    await startTurn.execute(browserSession(), startRequest(), sink);

    const completed = sink.events.find((e) => e.type === "turn.completed");
    if (!completed || completed.type !== "turn.completed") {
      throw new Error("esperado turn.completed");
    }
    expect(completed.usage).toEqual({
      input_tokens: 30,
      output_tokens: 9,
      cached_input_tokens: 12,
      cache_write_tokens: 7
    });
  });
});
