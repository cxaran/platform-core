import { describe, expect, it } from "vitest";
import { StartTurn } from "../../src/application/turns/start-turn.js";
import { ModelDiscoveryService } from "../../src/application/capabilities/model-discovery.js";
import { ProviderRegistry } from "../../src/providers/registry.js";
import { LocalProviderAdapter, createLocalModel } from "../../src/providers/local/adapter.js";
import { InMemoryModelCatalog } from "../../src/infrastructure/catalog/in-memory-model-catalog.js";
import { InMemoryTurnStore } from "../../src/infrastructure/turn-store/in-memory-turn-store.js";
import { NoopRateLimiter } from "../../src/infrastructure/rate-limit/noop-rate-limiter.js";
import type { TurnEvent, TurnEventSink } from "../../src/application/turns/start-turn.js";
import type { StartTurnRequest } from "../../src/application/capabilities/request-normalizer.js";
import type { GatewaySettings } from "../../src/config/settings.js";
import type { TelemetryPort } from "../../src/ports/telemetry.port.js";
import type { BrowserSession } from "../../src/domain/gateway-session.js";
import type { ControlPlanePort, TurnAuthorization } from "../../src/ports/control-plane.port.js";
import type { ProviderCredentialLease, ProviderEvent } from "../../src/ports/provider-adapter.port.js";
import type { ModelToolDefinition } from "../../src/domain/tool.js";

/**
 * Wiring del adaptador de runtime LOCAL (Ollama/vLLM) SIN servidor real. Enfatiza: la ruta SIN
 * AUTH (credencial vacía -> no se envía Authorization), capacidades honestas (unknown donde no
 * se proveen) y el relay de tool reusando el núcleo OpenAI-compatible.
 */

const BASE_URL = "http://local.test/v1";
const MODEL_ID = "llama3.1:8b";

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

// Control-plane que resuelve el perfil "ollama" y arrienda una credencial VACÍA (runtime local
// sin API key). El flujo de arriendo se mantiene (aislamiento por usuario) aunque la key venga
// vacía.
class LocalControlPlane implements ControlPlanePort {
  leasedSecrets: string[] = [];
  constructor(private readonly secret = "") {}
  async authorizeTurn(input: { browserSessionId: string; profileId: string }): Promise<TurnAuthorization> {
    return {
      userId: "user_test",
      sessionId: input.browserSessionId,
      tenantId: null,
      profileId: input.profileId,
      providerId: "ollama",
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
    this.leasedSecrets.push(this.secret);
    return { leaseId: "lease-1", secret: this.secret, expiresAt: new Date(Date.now() + 60_000) };
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

function sseResponse(payloads: string[]): Response {
  const body = payloads.map((p) => `data: ${p}\n\n`).join("") + "data: [DONE]\n\n";
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    }
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
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
    profileId: `ollama/${MODEL_ID}`,
    messages: [{ role: "user", content: [{ type: "text", text: "Hola" }] }],
    tools: [],
    generation: { maxOutputTokens: 100 },
    ...overrides
  };
}

function setup(responses: Response[], secret = "") {
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

  const adapter = new LocalProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
  const providerRegistry = new ProviderRegistry([adapter]);
  const modelCatalog = new InMemoryModelCatalog([createLocalModel({ baseUrl: BASE_URL, modelId: MODEL_ID })]);
  const controlPlane = new LocalControlPlane(secret);
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
  return { startTurn, turnStore, controlPlane, calls };
}

function types(events: TurnEvent[]): string[] {
  return events.map((e) => e.type);
}

describe("wiring runtime local (StartTurn -> lease vacío -> núcleo OpenAI-compat -> stream)", () => {
  it("completa un turno de texto SIN enviar Authorization (credencial vacía)", async () => {
    const { startTurn, turnStore, calls } = setup(
      [
        sseResponse([
          JSON.stringify({ choices: [{ delta: { content: "Hola doctor" } }] }),
          JSON.stringify({ choices: [{ finish_reason: "stop" }] })
        ])
      ],
      "" // sin API key
    );
    const sink = createSink();
    await startTurn.execute(browserSession(), startRequest(), sink);

    expect(types(sink.events)).toContain("turn.completed");
    expect(calls[0]?.url).toBe(`${BASE_URL}/chat/completions`);
    // Ruta SIN auth: NO se envía header Authorization.
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBeUndefined();

    const started = sink.events.find((e) => e.type === "turn.started");
    const turnId = started && "turn_id" in started ? started.turn_id : "";
    expect((await turnStore.get(turnId))?.status).toBe("completed");
  });

  it("acumula los deltas de texto en el snapshot", async () => {
    const { startTurn } = setup([
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "Hola " } }] }),
        JSON.stringify({ choices: [{ delta: { content: "doctor" } }] }),
        JSON.stringify({ choices: [{ finish_reason: "stop" }] })
      ])
    ]);
    const sink = createSink();
    await startTurn.execute(browserSession(), startRequest(), sink);
    const deltas = sink.events.filter((e) => e.type === "turn.text.delta");
    const last = deltas[deltas.length - 1];
    expect(last && "snapshot" in last ? last.snapshot : "").toBe("Hola doctor");
  });
});

describe("runtime local: auth condicional y relay de tool (nivel adaptador)", () => {
  async function collect(iterable: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
    const out: ProviderEvent[] = [];
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
      return queue.shift() ?? sseResponse([JSON.stringify({ choices: [{ finish_reason: "stop" }] })]);
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }
  const model = createLocalModel({ baseUrl: BASE_URL, modelId: MODEL_ID });
  const messages = [{ role: "user" as const, content: [{ type: "text" as const, text: "Hola" }] }];
  const toolDef: ModelToolDefinition = {
    name: "example.list_patients",
    description: "Lista registros",
    inputSchema: { type: "object", additionalProperties: false },
    strict: false
  };

  it("CON key (p. ej. vLLM con --api-key) envía Bearer", async () => {
    const { calls, fetchImpl } = fetchQueue([sseResponse([JSON.stringify({ choices: [{ finish_reason: "stop" }] })])]);
    const adapter = new LocalProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
    await collect(
      adapter.startTurn({
        turnId: "t1",
        model,
        credential: { leaseId: "l", secret: "vllm-key", expiresAt: new Date(Date.now() + 60_000) },
        messages,
        tools: [],
        options: { maxOutputTokens: 100 },
        signal: new AbortController().signal
      })
    );
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe("Bearer vllm-key");
  });

  it("relay de tool: tool_call.ready en start y completa en resume con mensaje tool", async () => {
    const { calls, fetchImpl } = fetchQueue([
      sseResponse([
        JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "example.list_patients", arguments: "{}" } }] } }]
        }),
        JSON.stringify({ choices: [{ finish_reason: "tool_calls" }] })
      ]),
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "Listo" } }] }),
        JSON.stringify({ choices: [{ finish_reason: "stop" }] })
      ])
    ]);
    const adapter = new LocalProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
    const credential = { leaseId: "l", secret: "", expiresAt: new Date(Date.now() + 60_000) };
    const startEvents = await collect(
      adapter.startTurn({ turnId: "t1", model, credential, messages, tools: [toolDef], options: { maxOutputTokens: 100 }, signal: new AbortController().signal })
    );
    const ready = startEvents.find((e) => e.type === "tool_call.ready");
    if (!ready || ready.type !== "tool_call.ready") {
      throw new Error("esperado tool_call.ready");
    }
    expect(ready.call.name).toBe("example.list_patients");

    const resumeEvents = await collect(
      adapter.resumeTurn({
        turnId: "t1",
        model,
        credential,
        toolResults: [{ callId: ready.call.callId, result: { status: "success", content: { items: [] } } }],
        continuationState: ready.continuationState ?? null,
        signal: new AbortController().signal
      })
    );
    expect(resumeEvents.some((e) => e.type === "completed")).toBe(true);
    // El resume reinyecta el resultado como mensaje role "tool" correlacionado por id.
    const resumeBody = JSON.parse(String(calls[1]?.init.body ?? "{}")) as {
      messages: Array<{ role: string; tool_call_id?: string }>;
    };
    const toolMsg = resumeBody.messages[resumeBody.messages.length - 1];
    expect(toolMsg?.role).toBe("tool");
    expect(toolMsg?.tool_call_id).toBe("call_1");
  });
});

describe("runtime local: tool calls PARALELAS se drenan una a una antes de volver al proveedor", () => {
  // Mismo drenado del núcleo compartido (advanceOpenAICompatContinuation) que usan OpenAI y
  // OpenRouter: el cable exige un mensaje `tool` por CADA tool_call_id del assistant antes del
  // siguiente request; sin drenado, upstreams estrictos rechazan con 400.
  async function collect(iterable: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
    const out: ProviderEvent[] = [];
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
      const next = queue.shift();
      if (!next) {
        throw new Error("fetch mock: sin respuestas en cola");
      }
      return next;
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }
  const model = createLocalModel({ baseUrl: BASE_URL, modelId: MODEL_ID });
  const credential = { leaseId: "l", secret: "", expiresAt: new Date(Date.now() + 60_000) };
  const messages = [{ role: "user" as const, content: [{ type: "text" as const, text: "Hola" }] }];
  const tools: ModelToolDefinition[] = [
    { name: "example.list_patients", description: "Lista", inputSchema: { type: "object" }, strict: false },
    { name: "example.list_tasks", description: "Tareas", inputSchema: { type: "object" }, strict: false }
  ];

  it("con dos tool calls paralelas, el primer resume despacha la segunda SIN llamar al proveedor", async () => {
    const { calls, fetchImpl } = fetchQueue([
      sseResponse([
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "call_1", function: { name: "example.list_patients", arguments: "{}" } },
                  { index: 1, id: "call_2", function: { name: "example.list_tasks", arguments: "{}" } }
                ]
              }
            }
          ]
        }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })
      ]),
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "Listo" } }] }),
        JSON.stringify({ choices: [{ finish_reason: "stop" }] })
      ])
    ]);
    const adapter = new LocalProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
    const startEvents = await collect(
      adapter.startTurn({ turnId: "t1", model, credential, messages, tools, options: { maxOutputTokens: 100 }, signal: new AbortController().signal })
    );
    const first = startEvents.find((e) => e.type === "tool_call.ready");
    if (!first || first.type !== "tool_call.ready") {
      throw new Error("esperado tool_call.ready");
    }
    expect(first.call.callId).toBe("call_1");

    // Primer resume: queda una paralela pendiente -> se emite al navegador sin ir al proveedor.
    const drainEvents = await collect(
      adapter.resumeTurn({
        turnId: "t1",
        model,
        credential,
        toolResults: [{ callId: "call_1", result: { status: "success", content: { ok: true } } }],
        continuationState: first.continuationState ?? null,
        signal: new AbortController().signal
      })
    );
    expect(calls).toHaveLength(1); // solo el startTurn pegó al proveedor
    const second = drainEvents[0];
    if (!second || second.type !== "tool_call.ready") {
      throw new Error("esperado tool_call.ready de la paralela pendiente");
    }
    expect(second.call.callId).toBe("call_2");
    expect(second.call.name).toBe("example.list_tasks");

    // Segundo resume (todas con resultado): vuelve al proveedor con ambos mensajes tool.
    const finishEvents = await collect(
      adapter.resumeTurn({
        turnId: "t1",
        model,
        credential,
        toolResults: [{ callId: "call_2", result: { status: "success", content: { ok: true } } }],
        continuationState: second.continuationState ?? null,
        signal: new AbortController().signal
      })
    );
    expect(finishEvents.some((e) => e.type === "completed")).toBe(true);
    expect(calls).toHaveLength(2);
    const resumeBody = JSON.parse(String(calls[1]?.init.body ?? "{}")) as {
      messages: Array<{ role: string; tool_call_id?: string }>;
    };
    const toolMessages = resumeBody.messages.filter((m) => m.role === "tool");
    expect(toolMessages.map((m) => m.tool_call_id)).toEqual(["call_1", "call_2"]);
  });
});

describe("runtime local: discovery y capacidades HONESTAS", () => {
  it("mapea /v1/models con defaults unknown y usa max_model_len si está", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: "llama3.1:8b", object: "model" },
            { id: "qwen2.5:7b", object: "model", max_model_len: 32768 }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as unknown as typeof fetch;
    const adapter = new LocalProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
    const models = await adapter.discoverModels({ leaseId: "l", secret: "", expiresAt: new Date() });
    expect(models).toHaveLength(2);

    const llama = models.find((m) => m.id === "ollama/llama3.1:8b")!;
    expect(llama.route.protocol).toBe("ollama_chat");
    expect(llama.route.providerModelId).toBe("llama3.1:8b");
    // Honesto: sin metadatos -> ventana null, tools/reasoning unknown, sin visión.
    expect(llama.capabilities.contextWindowTokens).toBeNull();
    expect(llama.capabilities.toolCalling.support).toBe("unknown");
    expect(llama.capabilities.compat.supportsTools).toBe(false);
    expect(llama.capabilities.reasoning.support).toBe("unknown");
    expect(llama.capabilities.compat.supportsReasoningEffort).toBe(false);
    expect(llama.capabilities.inputModalities.has("image")).toBe(false);

    const qwen = models.find((m) => m.id === "ollama/qwen2.5:7b")!;
    // max_model_len real -> ventana de contexto.
    expect(qwen.capabilities.contextWindowTokens).toBe(32768);
    expect(qwen.source).toBe("discovered");
  });

  it("createLocalModel curado (sin row) tiene caps honestas unknown", () => {
    const m = createLocalModel({ baseUrl: BASE_URL, modelId: "mistral:7b" });
    expect(m.source).toBe("curated");
    expect(m.capabilities.contextWindowTokens).toBeNull();
    expect(m.capabilities.compat.supportsTools).toBe(false);
    expect(m.capabilities.compat.supportsReasoningEffort).toBe(false);
  });

  it("discoverModels lanza PROVIDER_DISCOVERY_FAILED si /v1/models falla", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const adapter = new LocalProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
    await expect(adapter.discoverModels({ leaseId: "l", secret: "", expiresAt: new Date() })).rejects.toThrow();
  });
});
