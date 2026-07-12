import { describe, expect, it } from "vitest";
import {
  OpenAIProviderAdapter,
  createOpenAIModel,
  OPENAI_PROVIDER_ID
} from "../../src/providers/openai/adapter.js";
import { GatewayError } from "../../src/kernel/errors.js";
import type { GenerationOptions } from "../../src/application/capabilities/capability-negotiator.js";
import type { ProviderCredentialLease, ProviderEvent } from "../../src/ports/provider-adapter.port.js";
import type { CanonicalMessage } from "../../src/domain/message.js";
import type { ModelToolDefinition } from "../../src/domain/tool.js";
import type { ToolCallResult } from "../../src/domain/tool.js";

const BASE_URL = "https://openai.test/v1";
const SECRET = "sk-leased-openai-xyz";

const lease: ProviderCredentialLease = {
  leaseId: "lease-1",
  secret: SECRET,
  expiresAt: new Date(Date.now() + 60_000)
};

const options: GenerationOptions = { maxOutputTokens: 512, temperature: 0.2 };

interface Captured {
  url: string;
  init: RequestInit;
}

function sseResponse(payloads: string[], status = 200): Response {
  const body = payloads.map((p) => `data: ${p}\n\n`).join("") + "data: [DONE]\n\n";
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    }
  });
  return new Response(stream, { status, headers: { "content-type": "text/event-stream" } });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function adapterWith(
  responses: Response[],
  apiFlavor: "chat_completions" | "codex_responses" = "chat_completions"
): { adapter: OpenAIProviderAdapter; calls: Captured[] } {
  const calls: Captured[] = [];
  const queue = [...responses];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = queue.shift();
    if (!next) {
      throw new Error("fetch mock: sin respuestas en cola");
    }
    return next;
  }) as unknown as typeof fetch;
  return { adapter: new OpenAIProviderAdapter({ baseUrl: BASE_URL, apiFlavor, fetchImpl }), calls };
}

async function collect(iterable: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

const userMessage: CanonicalMessage[] = [{ role: "user", content: [{ type: "text", text: "Hola" }] }];
const tools: ModelToolDefinition[] = [
  { name: "example.list_patients", description: "Lista registros", inputSchema: { type: "object" }, strict: false }
];

// --- resolución de capacidades HONESTA ---

describe("createOpenAIModel (capacidades honestas)", () => {
  it("usa ventanas DOCUMENTADAS por familia cuando no hay metadatos del proveedor", () => {
    expect(createOpenAIModel({ baseUrl: BASE_URL, modelId: "gpt-5-codex" }).capabilities.contextWindowTokens).toBe(
      400000
    );
    expect(createOpenAIModel({ baseUrl: BASE_URL, modelId: "gpt-4o" }).capabilities.contextWindowTokens).toBe(128000);
  });

  it("deja contextWindow en null (desconocido) para ids no documentados", () => {
    const m = createOpenAIModel({ baseUrl: BASE_URL, modelId: "modelo-desconocido-xyz" });
    expect(m.capabilities.contextWindowTokens).toBeNull();
  });

  it("marca reasoning supported para familias que razonan (o-series, gpt-5) y unknown para el resto", () => {
    expect(createOpenAIModel({ baseUrl: BASE_URL, modelId: "o3" }).capabilities.reasoning.support).toBe("supported");
    expect(createOpenAIModel({ baseUrl: BASE_URL, modelId: "gpt-5-codex" }).capabilities.reasoning.support).toBe(
      "supported"
    );
    expect(createOpenAIModel({ baseUrl: BASE_URL, modelId: "gpt-4o" }).capabilities.reasoning.support).toBe("unknown");
  });

  it("prefiere los metadatos de la fila /models sobre la tabla documentada", () => {
    const m = createOpenAIModel({
      baseUrl: BASE_URL,
      modelId: "gpt-4o",
      row: { id: "gpt-4o", context_window: 64000, supports_tools: false, modalities: ["text", "image"] }
    });
    expect(m.capabilities.contextWindowTokens).toBe(64000);
    expect(m.capabilities.toolCalling.support).toBe("unsupported");
    expect(m.capabilities.inputModalities.has("image")).toBe(true);
    expect(m.source).toBe("discovered");
  });

  it("la ruta usa provider id 'openai' y el model id verbatim", () => {
    const m = createOpenAIModel({ baseUrl: BASE_URL, modelId: "gpt-5-codex" });
    expect(m.route.providerId).toBe(OPENAI_PROVIDER_ID);
    expect(m.route.providerModelId).toBe("gpt-5-codex");
    expect(m.id).toBe("openai/gpt-5-codex");
  });
});

// --- discovery ---

describe("discoverModels", () => {
  it("chat_completions: mapea filas reales de /models (ids verbatim)", async () => {
    const { adapter, calls } = adapterWith([
      jsonResponse({ data: [{ id: "gpt-4o" }, { id: "o3" }] })
    ]);
    const models = await adapter.discoverModels(lease);
    expect(models.map((m) => m.route.providerModelId)).toEqual(["gpt-4o", "o3"]);
    expect(calls[0]?.url).toBe(`${BASE_URL}/models`);
    // El Bearer arrendado viaja en Authorization.
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
  });

  it("chat_completions: lanza si /models falla", async () => {
    const { adapter } = adapterWith([jsonResponse({}, 500)]);
    await expect(adapter.discoverModels(lease)).rejects.toBeInstanceOf(GatewayError);
  });

  it("codex_responses: /models 404 NO es error (catálogo curado) -> []", async () => {
    const { adapter } = adapterWith([jsonResponse({}, 404)], "codex_responses");
    expect(await adapter.discoverModels(lease)).toEqual([]);
  });

  it("codex_responses: descubre EN VIVO los slugs desde /models?client_version y mapea capacidades", async () => {
    const calls: Captured[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return jsonResponse({
        models: [
          { slug: "gpt-5.5", context_window: 272000, input_modalities: ["text", "image"], supports_parallel_tool_calls: true, supports_reasoning_summaries: true },
          { slug: "gpt-5.4-mini", context_window: 272000, input_modalities: ["text"], supports_parallel_tool_calls: true }
        ]
      });
    }) as unknown as typeof fetch;
    const adapter = new OpenAIProviderAdapter({ baseUrl: BASE_URL, apiFlavor: "codex_responses", providerId: "openai_codex", fetchImpl });
    const oauthLease: ProviderCredentialLease = { ...lease, accountId: "acct_1" };
    const models = await adapter.discoverModels(oauthLease);

    expect(models.map((m) => m.id)).toEqual(["openai_codex/gpt-5.5", "openai_codex/gpt-5.4-mini"]);
    expect(calls[0]?.url).toContain("/models?client_version=");
    // El discovery manda el header de cuenta y NO es el /models estándar de OpenAI.
    expect((calls[0]?.init.headers as Record<string, string>)["chatgpt-account-id"]).toBe("acct_1");
    const top = models[0]!;
    expect(top.capabilities.contextWindowTokens).toBe(272000);
    expect(top.capabilities.inputModalities.has("image")).toBe(true);
    expect(top.capabilities.reasoning.support).toBe("supported");
    expect(top.route.providerId).toBe("openai_codex");
    expect(top.route.protocol).toBe("openai_codex");
  });
});

// --- streaming chat/completions ---

describe("startTurn chat_completions", () => {
  it("acumula deltas de texto, razonamiento y usage hasta completed", async () => {
    const { adapter, calls } = adapterWith([
      sseResponse([
        JSON.stringify({ choices: [{ delta: { reasoning_content: "pensando" } }] }),
        JSON.stringify({ choices: [{ delta: { content: "Hola " } }] }),
        JSON.stringify({ choices: [{ delta: { content: "doctor" } }] }),
        JSON.stringify({ choices: [{ finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 3 } })
      ])
    ]);
    const model = createOpenAIModel({ baseUrl: BASE_URL, modelId: "gpt-4o" });
    const events = await collect(
      adapter.startTurn({ turnId: "t1", model, credential: lease, messages: userMessage, tools: [], options, signal: new AbortController().signal })
    );
    const text = events.filter((e) => e.type === "text.delta").map((e) => (e as { delta: string }).delta).join("");
    expect(text).toBe("Hola doctor");
    expect(events.some((e) => e.type === "reasoning.summary")).toBe(true);
    const completed = events.find((e) => e.type === "completed");
    expect(completed).toMatchObject({ usage: { inputTokens: 10, outputTokens: 3 } });
    // Pega a /chat/completions con el model id verbatim.
    expect(calls[0]?.url).toBe(`${BASE_URL}/chat/completions`);
    expect(JSON.parse(String(calls[0]?.init.body)).model).toBe("gpt-4o");
  });

  it("relay de tool call: emite tool_call.ready y reanuda con el resultado", async () => {
    const { adapter, calls } = adapterWith([
      sseResponse([
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "example.list_patients", arguments: '{"limit":5}' } }] } }] }),
        JSON.stringify({ choices: [{ finish_reason: "tool_calls" }] })
      ]),
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "Listo" } }] }),
        JSON.stringify({ choices: [{ finish_reason: "stop" }] })
      ])
    ]);
    const model = createOpenAIModel({ baseUrl: BASE_URL, modelId: "gpt-4o" });
    const events = await collect(
      adapter.startTurn({ turnId: "t1", model, credential: lease, messages: userMessage, tools, options, signal: new AbortController().signal })
    );
    const ready = events.find((e) => e.type === "tool_call.ready") as
      | { type: "tool_call.ready"; call: { callId: string; name: string; arguments: unknown }; continuationState: unknown }
      | undefined;
    expect(ready?.call.name).toBe("example.list_patients");
    expect(ready?.call.arguments).toEqual({ limit: 5 });

    const toolResult: ToolCallResult = {
      callId: ready!.call.callId,
      result: { status: "success", content: { items: [] } }
    };
    const resumed = await collect(
      adapter.resumeTurn({ turnId: "t1", model, credential: lease, toolResults: [toolResult], continuationState: ready!.continuationState, signal: new AbortController().signal })
    );
    expect(resumed.filter((e) => e.type === "text.delta").map((e) => (e as { delta: string }).delta).join("")).toBe("Listo");
    // La reanudación reenvía el historial con el mensaje tool (tool_call_id correlacionado).
    const resumeBody = JSON.parse(String(calls[1]?.init.body));
    const toolMsg = resumeBody.messages.find((m: { role: string }) => m.role === "tool");
    expect(toolMsg.tool_call_id).toBe(ready!.call.callId);
  });
});

// --- streaming + tool relay codex_responses (app-server Codex) ---

describe("startTurn codex_responses", () => {
  it("acumula response.output_text.delta y usage hasta response.completed", async () => {
    const { adapter, calls } = adapterWith(
      [
        sseResponse([
          JSON.stringify({ type: "response.reasoning_summary_text.delta", delta: "analizo" }),
          JSON.stringify({ type: "response.output_text.delta", delta: "Hola " }),
          JSON.stringify({ type: "response.output_text.delta", delta: "Plus" }),
          JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 12, output_tokens: 2 } } })
        ])
      ],
      "codex_responses"
    );
    const model = createOpenAIModel({ baseUrl: BASE_URL, modelId: "gpt-5-codex", apiFlavor: "codex_responses" });
    const events = await collect(
      adapter.startTurn({ turnId: "t1", model, credential: lease, messages: userMessage, tools: [], options, signal: new AbortController().signal })
    );
    expect(events.filter((e) => e.type === "text.delta").map((e) => (e as { delta: string }).delta).join("")).toBe("Hola Plus");
    expect(events.some((e) => e.type === "reasoning.summary")).toBe(true);
    expect(events.find((e) => e.type === "completed")).toMatchObject({ usage: { inputTokens: 12, outputTokens: 2 } });
    // Pega a /responses con input[] y el model id verbatim.
    expect(calls[0]?.url).toBe(`${BASE_URL}/responses`);
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.model).toBe("gpt-5-codex");
    expect(Array.isArray(body.input)).toBe(true);
  });

  it("relay de tool call vía response.output_item.done y reanuda con function_call_output", async () => {
    const { adapter, calls } = adapterWith(
      [
        sseResponse([
          // Codex devuelve el nombre SANEADO (sin punto) porque así se lo enviamos.
          JSON.stringify({ type: "response.output_item.done", item: { type: "function_call", call_id: "fc_1", name: "example_list_patients", arguments: '{"limit":3}' } })
        ]),
        sseResponse([
          JSON.stringify({ type: "response.output_text.delta", delta: "Hecho" }),
          JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 5, output_tokens: 1 } } })
        ])
      ],
      "codex_responses"
    );
    const model = createOpenAIModel({ baseUrl: BASE_URL, modelId: "gpt-5-codex", apiFlavor: "codex_responses" });
    const events = await collect(
      adapter.startTurn({ turnId: "t1", model, credential: lease, messages: userMessage, tools, options, signal: new AbortController().signal })
    );
    const ready = events.find((e) => e.type === "tool_call.ready") as
      | { type: "tool_call.ready"; call: { callId: string; name: string; arguments: unknown }; continuationState: unknown }
      | undefined;
    // El nombre se recupera al ORIGINAL (con punto) para que el navegador ejecute la tool.
    expect(ready?.call.name).toBe("example.list_patients");
    expect(ready?.call.arguments).toEqual({ limit: 3 });
    // Lo enviado a Codex va SANEADO (sin punto), que es lo que el Responses API exige.
    expect(JSON.parse(String(calls[0]?.init.body)).tools[0].name).toBe("example_list_patients");

    const toolResult: ToolCallResult = { callId: "fc_1", result: { status: "success", content: "ok" } };
    const resumed = await collect(
      adapter.resumeTurn({ turnId: "t1", model, credential: lease, toolResults: [toolResult], continuationState: ready!.continuationState, signal: new AbortController().signal })
    );
    expect(resumed.filter((e) => e.type === "text.delta").map((e) => (e as { delta: string }).delta).join("")).toBe("Hecho");
    // La reanudación reenvía el input con el function_call y el function_call_output correlacionados.
    const resumeBody = JSON.parse(String(calls[1]?.init.body));
    const out = resumeBody.input.find((i: { type: string }) => i.type === "function_call_output");
    expect(out.call_id).toBe("fc_1");
    expect(resumeBody.input.some((i: { type: string }) => i.type === "function_call")).toBe(true);
  });

  it("envía headers Codex (chatgpt-account-id, originator, OpenAI-Beta, session_id) y store:false", async () => {
    const { adapter, calls } = adapterWith(
      [
        sseResponse([
          JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } })
        ])
      ],
      "codex_responses"
    );
    const model = createOpenAIModel({ baseUrl: BASE_URL, modelId: "gpt-5-codex", apiFlavor: "codex_responses" });
    const oauthLease: ProviderCredentialLease = { ...lease, accountId: "acct_123" };
    // El prompt de sistema debe ir como `instructions`, no como item de input.
    const messages: CanonicalMessage[] = [
      { role: "system", content: [{ type: "text", text: "Eres un asistente." }] },
      { role: "user", content: [{ type: "text", text: "Hola" }] }
    ];
    await collect(
      adapter.startTurn({ turnId: "t1", model, credential: oauthLease, messages, tools: [], options, signal: new AbortController().signal })
    );
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(headers["chatgpt-account-id"]).toBe("acct_123");
    expect(headers.originator).toBe("codex_cli_rs");
    expect(headers["OpenAI-Beta"]).toBe("responses=experimental");
    expect(typeof headers.session_id).toBe("string");
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.store).toBe(false);
    expect(body.instructions).toBe("Eres un asistente.");
    // El sistema NO debe duplicarse como item de input.
    expect(body.input.some((i: { role?: string }) => i.role === "system")).toBe(false);
  });

  it("omite chatgpt-account-id cuando el lease no trae cuenta (API key)", async () => {
    const { adapter, calls } = adapterWith(
      [sseResponse([JSON.stringify({ type: "response.completed", response: { usage: {} } })])],
      "codex_responses"
    );
    const model = createOpenAIModel({ baseUrl: BASE_URL, modelId: "gpt-5-codex", apiFlavor: "codex_responses" });
    await collect(
      adapter.startTurn({ turnId: "t1", model, credential: lease, messages: userMessage, tools: [], options, signal: new AbortController().signal })
    );
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect("chatgpt-account-id" in headers).toBe(false);
  });

  it("response.failed en el stream lanza GatewayError", async () => {
    const { adapter } = adapterWith([sseResponse([JSON.stringify({ type: "response.failed" })])], "codex_responses");
    const model = createOpenAIModel({ baseUrl: BASE_URL, modelId: "gpt-5-codex", apiFlavor: "codex_responses" });
    await expect(
      collect(adapter.startTurn({ turnId: "t1", model, credential: lease, messages: userMessage, tools: [], options, signal: new AbortController().signal }))
    ).rejects.toBeInstanceOf(GatewayError);
  });
});
