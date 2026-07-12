import { describe, expect, it } from "vitest";
import { StartTurn } from "../../src/application/turns/start-turn.js";
import { ResumeTurnAfterTool } from "../../src/application/turns/resume-turn-after-tool.js";
import { ModelDiscoveryService } from "../../src/application/capabilities/model-discovery.js";
import { ProviderRegistry } from "../../src/providers/registry.js";
import { OpenAIProviderAdapter, createOpenAIModel } from "../../src/providers/openai/adapter.js";
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
 * Wiring end-to-end del adaptador OpenAI/Codex SIN OpenAI real: control-plane que resuelve
 * el perfil "openai", arriendo de credencial, StartTurn -> stream -> relay de tool ->
 * ResumeTurnAfterTool. El proveedor se mockea con un fetch en cola (SSE OpenAI-compatible).
 */

const BASE_URL = "https://openai.test/v1";

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

// Control-plane que enruta al proveedor "openai" (perfil codex/openai) y arrienda un Bearer.
class OpenAIControlPlane implements ControlPlanePort {
  leasedSecrets: string[] = [];
  async authorizeTurn(input: { browserSessionId: string; profileId: string }): Promise<TurnAuthorization> {
    return {
      userId: "user_test",
      sessionId: input.browserSessionId,
      tenantId: null,
      profileId: input.profileId,
      providerId: "openai",
      credentialId: "user_test",
      modelId: "gpt-4o",
      allowedCapabilities: { tools: true, structuredOutput: true, reasoning: false, images: false, audio: false },
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
    const secret = "leased-openai-token";
    this.leasedSecrets.push(secret);
    return { leaseId: "lease-1", secret, expiresAt: new Date(Date.now() + 60_000) };
  }
  async leaseCredentialForProvider(): Promise<ProviderCredentialLease | null> {
    // Sin discovery por proveedor en el test: se resuelve por catálogo curado.
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
    profileId: "openai/gpt-4o",
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

  const adapter = new OpenAIProviderAdapter({ baseUrl: BASE_URL, fetchImpl });
  const providerRegistry = new ProviderRegistry([adapter]);
  const modelCatalog = new InMemoryModelCatalog([createOpenAIModel({ baseUrl: BASE_URL, modelId: "gpt-4o" })]);
  const controlPlane = new OpenAIControlPlane();
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

describe("wiring OpenAI/Codex (StartTurn -> lease -> adapter -> stream -> resume)", () => {
  it("resuelve el perfil openai, arrienda y completa un turno de texto", async () => {
    const { startTurn, turnStore, controlPlane, calls } = setup([
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "Hola doctor" } }] }),
        JSON.stringify({ choices: [{ finish_reason: "stop" }], usage: { prompt_tokens: 4, completion_tokens: 2 } })
      ])
    ]);
    const sink = createSink();
    await startTurn.execute(browserSession(), startRequest(), sink);

    expect(types(sink.events)).toContain("turn.started");
    expect(types(sink.events)).toContain("turn.completed");
    // Se arrendó la credencial y se usó el Bearer contra /chat/completions.
    expect(controlPlane.leasedSecrets).toEqual(["leased-openai-token"]);
    expect(calls[0]?.url).toBe(`${BASE_URL}/chat/completions`);
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe("Bearer leased-openai-token");

    const started = sink.events.find((e) => e.type === "turn.started");
    const turnId = started && "turn_id" in started ? started.turn_id : "";
    expect((await turnStore.get(turnId))?.status).toBe("completed");
  });

  it("relay de tool: waiting_for_tool tras el tool_call y completa al reanudar", async () => {
    const { startTurn, resume, turnStore } = setup([
      sseResponse([
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "example.list_patients", arguments: "{}" } }] } }] }),
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
});

describe("mapeo de reasoning normalizado -> nativo (P5)", () => {
  function captureBody(responses: Response[]) {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const queue = [...responses];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
      const next = queue.shift();
      if (!next) {
        throw new Error("fetch mock: sin respuestas en cola");
      }
      return next;
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  const credential = { leaseId: "l1", secret: "tok", expiresAt: new Date(Date.now() + 60_000) };
  const messages = [{ role: "user" as const, content: [{ type: "text" as const, text: "Hola" }] }];

  async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
    for await (const _ of iterable) {
      void _;
    }
  }

  it("chat_completions: 'max' se envía como reasoning_effort 'high' en un modelo con razonamiento", async () => {
    const { calls, fetchImpl } = captureBody([
      sseResponse([JSON.stringify({ choices: [{ finish_reason: "stop" }] })])
    ]);
    const adapter = new OpenAIProviderAdapter({ baseUrl: BASE_URL, apiFlavor: "chat_completions", fetchImpl });
    const model = createOpenAIModel({ baseUrl: BASE_URL, modelId: "gpt-5", apiFlavor: "chat_completions" });
    expect(model.capabilities.compat.supportsReasoningEffort).toBe(true);
    await drain(
      adapter.startTurn({
        turnId: "t1",
        model,
        credential,
        messages,
        tools: [],
        options: { maxOutputTokens: 100, reasoningEffort: "max" },
        signal: new AbortController().signal
      })
    );
    expect(calls[0]?.body.reasoning_effort).toBe("high");
  });

  it("codex_responses: 'low' se envía como reasoning.effort 'low'", async () => {
    const { calls, fetchImpl } = captureBody([
      sseResponse([JSON.stringify({ type: "response.completed", response: { usage: {} } })])
    ]);
    const adapter = new OpenAIProviderAdapter({ baseUrl: BASE_URL, apiFlavor: "codex_responses", fetchImpl });
    const model = createOpenAIModel({ baseUrl: BASE_URL, modelId: "gpt-5-codex", apiFlavor: "codex_responses" });
    await drain(
      adapter.startTurn({
        turnId: "t1",
        model,
        credential,
        messages,
        tools: [],
        options: { maxOutputTokens: 100, reasoningEffort: "low" },
        signal: new AbortController().signal
      })
    );
    expect((calls[0]?.body.reasoning as { effort?: string })?.effort).toBe("low");
  });

  it("omite el parámetro cuando el nivel es 'off'", async () => {
    const { calls, fetchImpl } = captureBody([
      sseResponse([JSON.stringify({ choices: [{ finish_reason: "stop" }] })])
    ]);
    const adapter = new OpenAIProviderAdapter({ baseUrl: BASE_URL, apiFlavor: "chat_completions", fetchImpl });
    const model = createOpenAIModel({ baseUrl: BASE_URL, modelId: "gpt-5", apiFlavor: "chat_completions" });
    await drain(
      adapter.startTurn({
        turnId: "t1",
        model,
        credential,
        messages,
        tools: [],
        options: { maxOutputTokens: 100, reasoningEffort: "off" },
        signal: new AbortController().signal
      })
    );
    expect(calls[0]?.body.reasoning_effort).toBeUndefined();
  });

  it("omite el parámetro en un modelo sin razonamiento (gpt-4o)", async () => {
    const { calls, fetchImpl } = captureBody([
      sseResponse([JSON.stringify({ choices: [{ finish_reason: "stop" }] })])
    ]);
    const adapter = new OpenAIProviderAdapter({ baseUrl: BASE_URL, apiFlavor: "chat_completions", fetchImpl });
    const model = createOpenAIModel({ baseUrl: BASE_URL, modelId: "gpt-4o", apiFlavor: "chat_completions" });
    expect(model.capabilities.compat.supportsReasoningEffort).toBe(false);
    await drain(
      adapter.startTurn({
        turnId: "t1",
        model,
        credential,
        messages,
        tools: [],
        options: { maxOutputTokens: 100, reasoningEffort: "high" },
        signal: new AbortController().signal
      })
    );
    expect(calls[0]?.body.reasoning_effort).toBeUndefined();
  });
});
