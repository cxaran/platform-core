import { describe, expect, it } from "vitest";
import { StartTurn } from "../../src/application/turns/start-turn.js";
import { ResumeTurnAfterTool } from "../../src/application/turns/resume-turn-after-tool.js";
import { ModelDiscoveryService } from "../../src/application/capabilities/model-discovery.js";
import { ProviderRegistry } from "../../src/providers/registry.js";
import { OpenRouterProviderAdapter, createOpenRouterModel } from "../../src/providers/openrouter/adapter.js";
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
 * Wiring end-to-end del adaptador OpenRouter SIN Google/OpenRouter real: control-plane que
 * resuelve el perfil "openrouter", arriendo, StartTurn -> stream (chat/completions del núcleo
 * OpenAI-compatible) -> relay de tool -> ResumeTurnAfterTool. ÉNFASIS en el DISCOVERY RICO:
 * /models con metadatos reales mapeado a nuestras capacidades.
 */

const BASE_URL = "https://openrouter.test/api/v1";
const MODEL_ID = "anthropic/claude-3.7-sonnet";

// Fila rica de /models (forma real de OpenRouter): metadatos de capacidad de verdad.
const RICH_ROW = {
  id: MODEL_ID,
  name: "Anthropic: Claude 3.7 Sonnet",
  created: 1709,
  context_length: 200000,
  architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
  top_provider: { context_length: 200000, max_completion_tokens: 8192 },
  supported_parameters: ["tools", "tool_choice", "reasoning", "include_reasoning", "max_tokens", "temperature"]
};

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

class OpenRouterControlPlane implements ControlPlanePort {
  leasedSecrets: string[] = [];
  async authorizeTurn(input: { browserSessionId: string; profileId: string }): Promise<TurnAuthorization> {
    return {
      userId: "user_test",
      sessionId: input.browserSessionId,
      tenantId: null,
      profileId: input.profileId,
      providerId: "openrouter",
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
    const secret = "leased-openrouter-key";
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
    profileId: `openrouter/${MODEL_ID}`,
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

  const adapter = new OpenRouterProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
  const providerRegistry = new ProviderRegistry([adapter]);
  // Catálogo con la fila RICA (caps reales: tools + reasoning + visión).
  const modelCatalog = new InMemoryModelCatalog([
    createOpenRouterModel({ baseUrl: BASE_URL, modelId: MODEL_ID, row: RICH_ROW })
  ]);
  const controlPlane = new OpenRouterControlPlane();
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

describe("wiring OpenRouter (StartTurn -> lease -> núcleo OpenAI-compat -> stream -> resume)", () => {
  it("resuelve el perfil openrouter, arrienda y completa un turno de texto", async () => {
    const { startTurn, turnStore, controlPlane, calls } = setup([
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "Hola doctor" } }] }),
        JSON.stringify({ choices: [{ finish_reason: "stop" }], usage: { prompt_tokens: 4, completion_tokens: 2 } })
      ])
    ]);
    const sink = createSink();
    await startTurn.execute(browserSession(), startRequest(), sink);

    expect(types(sink.events)).toContain("turn.completed");
    expect(controlPlane.leasedSecrets).toEqual(["leased-openrouter-key"]);
    expect(calls[0]?.url).toBe(`${BASE_URL}/chat/completions`);
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe("Bearer leased-openrouter-key");

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

  it("relay de tool: waiting_for_tool tras el tool_call y completa al reanudar", async () => {
    const { startTurn, resume, turnStore } = setup([
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

  it("relay de tools PARALELAS: drena una a una y reanuda con un mensaje tool por cada tool_call_id", async () => {
    const secondTool: ModelToolDefinition = {
      name: "example.patient_summary",
      description: "Resumen del registro",
      inputSchema: { type: "object", additionalProperties: false },
      strict: false
    };
    const { startTurn, resume, turnStore, calls } = setup([
      // El modelo pide DOS tools en el mismo mensaje assistant.
      sseResponse([
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "call_a", function: { name: "example.list_patients", arguments: "{}" } },
                  { index: 1, id: "call_b", function: { name: "example.patient_summary", arguments: '{"patient_id":"p1"}' } }
                ]
              }
            }
          ]
        }),
        JSON.stringify({ choices: [{ finish_reason: "tool_calls" }] })
      ]),
      // Única llamada de reanudación al proveedor (tras drenar ambas tools).
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "Listo" } }] }),
        JSON.stringify({ choices: [{ finish_reason: "stop" }] })
      ])
    ]);
    const startSink = createSink();
    await startTurn.execute(browserSession(), startRequest({ tools: [toolDef, secondTool] }), startSink);
    const firstCall = startSink.events.find((e) => e.type === "turn.tool_call.ready");
    if (!firstCall || firstCall.type !== "turn.tool_call.ready") {
      throw new Error("esperado turn.tool_call.ready");
    }
    expect(firstCall.call_id).toBe("call_a");

    // Resultado de la primera: el turno vuelve a waiting_for_tool con la SEGUNDA, sin fetch.
    const drainSink = createSink();
    await resume.execute(
      firstCall.turn_id,
      { callId: "call_a", result: { status: "success", content: { items: [] } } },
      drainSink
    );
    const secondCall = drainSink.events.find((e) => e.type === "turn.tool_call.ready");
    if (!secondCall || secondCall.type !== "turn.tool_call.ready") {
      throw new Error("esperado turn.tool_call.ready de la segunda tool");
    }
    expect(secondCall.call_id).toBe("call_b");
    expect(secondCall.tool_name).toBe("example.patient_summary");
    expect((await turnStore.get(firstCall.turn_id))?.status).toBe("waiting_for_tool");
    expect(calls).toHaveLength(1); // solo el startTurn ha llamado al proveedor

    // Resultado de la segunda: recién ahora se reanuda con el proveedor y completa.
    const finalSink = createSink();
    await resume.execute(
      firstCall.turn_id,
      { callId: "call_b", result: { status: "success", content: { summary: "ok" } } },
      finalSink
    );
    expect(types(finalSink.events)).toContain("turn.completed");
    expect((await turnStore.get(firstCall.turn_id))?.status).toBe("completed");

    // El request de reanudación lleva el assistant con AMBAS tool_calls y un tool por cada id.
    expect(calls).toHaveLength(2);
    const sent = JSON.parse(String(calls[1]!.init.body)) as {
      messages: { role: string; tool_calls?: { id: string }[]; tool_call_id?: string }[];
    };
    const assistantMsg = sent.messages.find((m) => m.role === "assistant");
    expect(assistantMsg?.tool_calls?.map((c) => c.id)).toEqual(["call_a", "call_b"]);
    expect(sent.messages.filter((m) => m.role === "tool").map((m) => m.tool_call_id)).toEqual([
      "call_a",
      "call_b"
    ]);
  });
});

describe("OpenRouter: DISCOVERY RICO (consume metadatos reales de /models)", () => {
  it("mapea context_length, supported_parameters y modalities a nuestras capacidades", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ data: [RICH_ROW] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })) as unknown as typeof fetch;
    const adapter = new OpenRouterProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
    const models = await adapter.discoverModels({ leaseId: "l", secret: "k", expiresAt: new Date() });
    expect(models).toHaveLength(1);
    const m = models[0]!;
    expect(m.id).toBe(`openrouter/${MODEL_ID}`);
    expect(m.route.protocol).toBe("openai_chat_completions");
    expect(m.route.providerModelId).toBe(MODEL_ID);
    // context_length real -> ventana de contexto.
    expect(m.capabilities.contextWindowTokens).toBe(200000);
    // top_provider.max_completion_tokens real -> cap de salida.
    expect(m.capabilities.maxOutputTokens).toBe(8192);
    // supported_parameters incluye tools/reasoning -> soportados.
    expect(m.capabilities.toolCalling.support).toBe("supported");
    expect(m.capabilities.compat.supportsTools).toBe(true);
    expect(m.capabilities.reasoning.support).toBe("supported");
    expect(m.capabilities.compat.supportsReasoningEffort).toBe(true);
    // architecture.input_modalities incluye image -> visión.
    expect(m.capabilities.inputModalities.has("image")).toBe(true);
    expect(m.source).toBe("discovered");
  });

  it("HONESTO: sin supported_parameters, las capacidades quedan unknown/false (no se inventan)", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          data: [{ id: "vendor/modelo-sin-metadatos", context_length: 8192 }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as unknown as typeof fetch;
    const adapter = new OpenRouterProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
    const models = await adapter.discoverModels({ leaseId: "l", secret: "k", expiresAt: new Date() });
    const m = models[0]!;
    expect(m.capabilities.contextWindowTokens).toBe(8192);
    // Sin supported_parameters: ni tools ni reasoning se asumen.
    expect(m.capabilities.toolCalling.support).toBe("unknown");
    expect(m.capabilities.compat.supportsTools).toBe(false);
    expect(m.capabilities.reasoning.support).toBe("unknown");
    expect(m.capabilities.compat.supportsReasoningEffort).toBe(false);
    // Sin architecture: solo texto.
    expect(m.capabilities.inputModalities.has("image")).toBe(false);
    // Sin top_provider: cap de salida desconocido.
    expect(m.capabilities.maxOutputTokens).toBeNull();
  });

  it("supported_parameters sin reasoning -> reasoning unsupported", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ data: [{ id: "vendor/solo-tools", context_length: 32768, supported_parameters: ["tools"] }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as unknown as typeof fetch;
    const adapter = new OpenRouterProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
    const models = await adapter.discoverModels({ leaseId: "l", secret: "k", expiresAt: new Date() });
    const m = models[0]!;
    expect(m.capabilities.toolCalling.support).toBe("supported");
    expect(m.capabilities.reasoning.support).toBe("unsupported");
    expect(m.capabilities.compat.supportsReasoningEffort).toBe(false);
  });

  it("discoverModels lanza PROVIDER_DISCOVERY_FAILED si /models falla", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const adapter = new OpenRouterProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
    await expect(adapter.discoverModels({ leaseId: "l", secret: "k", expiresAt: new Date() })).rejects.toThrow();
  });

  it("mapea el bloque pricing real de /models a ModelPricing (precio por token, USD) (P7)", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: MODEL_ID,
              context_length: 200000,
              pricing: {
                prompt: "0.000003",
                completion: "0.000015",
                input_cache_read: "0.0000003",
                input_cache_write: "0.00000375"
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as unknown as typeof fetch;
    const adapter = new OpenRouterProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
    const models = await adapter.discoverModels({ leaseId: "l", secret: "k", expiresAt: new Date() });
    expect(models[0]!.pricing).toEqual({
      currency: "USD",
      promptPerToken: 0.000003,
      completionPerToken: 0.000015,
      cacheReadPerToken: 0.0000003,
      cacheWritePerToken: 0.00000375
    });
  });

  it("HONESTO: sin bloque pricing, pricing queda null (precio desconocido)", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ data: [{ id: MODEL_ID, context_length: 8192 }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })) as unknown as typeof fetch;
    const adapter = new OpenRouterProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
    const models = await adapter.discoverModels({ leaseId: "l", secret: "k", expiresAt: new Date() });
    expect(models[0]!.pricing).toBeNull();
  });

  it("pricing parcial: campos ausentes/no numéricos quedan en null (no se inventan)", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          data: [{ id: MODEL_ID, pricing: { prompt: "0.000002", completion: "no-numero" } }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as unknown as typeof fetch;
    const adapter = new OpenRouterProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
    const models = await adapter.discoverModels({ leaseId: "l", secret: "k", expiresAt: new Date() });
    expect(models[0]!.pricing).toEqual({
      currency: "USD",
      promptPerToken: 0.000002,
      completionPerToken: null,
      cacheReadPerToken: null,
      cacheWritePerToken: null
    });
  });
});

describe("OpenRouter: mapeo de reasoning normalizado -> reasoning: { effort }", () => {
  async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
    for await (const _ of iterable) {
      void _;
    }
  }
  function captureBody() {
    const calls: { body: Record<string, unknown> }[] = [];
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body ?? "{}")) });
      return sseResponse([JSON.stringify({ choices: [{ finish_reason: "stop" }] })]);
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }
  const credential = { leaseId: "l1", secret: "k", expiresAt: new Date(Date.now() + 60_000) };
  const messages = [{ role: "user" as const, content: [{ type: "text" as const, text: "Hola" }] }];

  it("'max' se envía como reasoning.effort 'high' (param unificado de OpenRouter)", async () => {
    const { calls, fetchImpl } = captureBody();
    const adapter = new OpenRouterProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
    const model = createOpenRouterModel({ baseUrl: BASE_URL, modelId: MODEL_ID, row: RICH_ROW });
    expect(model.capabilities.compat.supportsReasoningEffort).toBe(true);
    await drain(
      adapter.startTurn({
        turnId: "t1",
        model,
        credential,
        messages,
        tools: [],
        options: { maxOutputTokens: 1024, reasoningEffort: "max" },
        signal: new AbortController().signal
      })
    );
    expect(calls[0]?.body.reasoning).toEqual({ effort: "high" });
  });

  it("modelo sin reasoning omite el parámetro aunque se pida 'high'", async () => {
    const { calls, fetchImpl } = captureBody();
    const adapter = new OpenRouterProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
    const model = createOpenRouterModel({
      baseUrl: BASE_URL,
      modelId: "vendor/solo-tools",
      row: { id: "vendor/solo-tools", supported_parameters: ["tools"] }
    });
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
    expect(calls[0]?.body.reasoning).toBeUndefined();
  });
});
