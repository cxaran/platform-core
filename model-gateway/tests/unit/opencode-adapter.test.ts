import { describe, expect, it } from "vitest";
import {
  OpencodeProviderAdapter,
  createOpencodeModel,
  normalizeToolSequence,
  opencodeSupportsVision,
  OPENCODE_PROVIDER_ID,
  OPENCODE_GO_PROVIDER_ID
} from "../../src/providers/opencode/adapter.js";
import { GatewayError } from "../../src/kernel/errors.js";
import type { GenerationOptions } from "../../src/application/capabilities/capability-negotiator.js";
import type { ProviderCredentialLease, ProviderEvent } from "../../src/ports/provider-adapter.port.js";
import type { CanonicalMessage } from "../../src/domain/message.js";
import type { ModelToolDefinition } from "../../src/domain/tool.js";

const BASE_URL = "https://opencode.test/v1";
const SECRET = "sk-leased-secret-xyz";

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

/** Construye un Response SSE a partir de payloads JSON (uno por evento `data:`). */
function sseResponse(payloads: string[], status = 200): Response {
  const body = payloads.map((p) => `data: ${p}\n\n`).join("") + "data: [DONE]\n\n";
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    }
  });
  return new Response(stream, {
    status,
    headers: { "content-type": "text/event-stream" }
  });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function adapterWith(responses: Response[]): { adapter: OpencodeProviderAdapter; calls: Captured[] } {
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

  return { adapter: new OpencodeProviderAdapter({ baseUrl: BASE_URL, fetchImpl }), calls };
}

async function collect(iterable: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

const model = createOpencodeModel({ baseUrl: BASE_URL, modelId: "test-model" });
const userMessage: CanonicalMessage[] = [{ role: "user", content: [{ type: "text", text: "Hola" }] }];

describe("opencode visión (mapa curado de modalidades)", () => {
  it("marca image en inputModalities para modelos de visión curados (sufijo -free ignorado)", () => {
    for (const id of ["qwen3.7-plus", "mimo-v2.5", "kimi-k2.7-code", "mimo-v2.5-free"]) {
      expect(opencodeSupportsVision(id)).toBe(true);
      const m = createOpencodeModel({ baseUrl: BASE_URL, modelId: id });
      expect(m.capabilities.inputModalities.has("image")).toBe(true);
    }
  });

  it("trata como text-only los modelos sin visión conocida", () => {
    for (const id of ["minimax-m3", "deepseek-v4-flash-free", "glm-5.2", "test-model"]) {
      expect(opencodeSupportsVision(id)).toBe(false);
      const m = createOpencodeModel({ baseUrl: BASE_URL, modelId: id });
      expect(m.capabilities.inputModalities.has("image")).toBe(false);
    }
  });

  it("familias multimodales de Zen (claude-*, gemini-*) reportan visión", () => {
    expect(opencodeSupportsVision("claude-fable-5")).toBe(true);
    expect(opencodeSupportsVision("gemini-3-pro")).toBe(true);
  });

  it("el metadato modalities del row tiene prioridad sobre el mapa curado", () => {
    // Row dice text-only para un id que el mapa marcaría como visión.
    const m = createOpencodeModel({
      baseUrl: BASE_URL,
      modelId: "qwen3.7-plus",
      row: { id: "qwen3.7-plus", modalities: ["text"] }
    });
    expect(m.capabilities.inputModalities.has("image")).toBe(false);
  });
});

describe("OpencodeProviderAdapter.discoverModels", () => {
  it("mapea /models a ModelDescriptor[] con capacidades", async () => {
    const { adapter } = adapterWith([
      jsonResponse({
        data: [
          { id: "modelo-a", name: "Modelo A", context_length: 200000, max_output_tokens: 8192, supports_tools: true },
          { id: "modelo-b", supports_tools: false, supports_reasoning: true }
        ]
      })
    ]);

    const models = await adapter.discoverModels(lease);
    expect(models).toHaveLength(2);

    const a = models[0]!;
    expect(a.id).toBe(`${OPENCODE_PROVIDER_ID}/modelo-a`);
    expect(a.route.protocol).toBe(OPENCODE_PROVIDER_ID);
    expect(a.label).toBe("Modelo A");
    expect(a.capabilities.contextWindowTokens).toBe(200000);
    expect(a.capabilities.maxOutputTokens).toBe(8192);
    expect(a.capabilities.toolCalling.support).toBe("supported");
    expect(a.source).toBe("discovered");

    const b = models[1]!;
    expect(b.capabilities.toolCalling.support).toBe("unsupported");
    expect(b.capabilities.compat.supportsTools).toBe(false);
    expect(b.capabilities.reasoning.support).toBe("supported");
  });

  it("lanza GatewayError si /models falla", async () => {
    const { adapter } = adapterWith([jsonResponse({ error: "boom" }, 500)]);
    await expect(adapter.discoverModels(lease)).rejects.toBeInstanceOf(GatewayError);
  });
});

describe("OpencodeProviderAdapter.startTurn", () => {
  it("traduce deltas de texto y un completed con usage", async () => {
    const { adapter, calls } = adapterWith([
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "Hola " } }] }),
        JSON.stringify({ choices: [{ delta: { content: "mundo" } }] }),
        JSON.stringify({
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 2 } }
        })
      ])
    ]);

    const events = await collect(
      adapter.startTurn({
        turnId: "t1",
        model,
        credential: lease,
        messages: userMessage,
        tools: [],
        options,
        signal: new AbortController().signal
      })
    );

    expect(events).toEqual([
      { type: "text.delta", delta: "Hola " },
      { type: "text.delta", delta: "mundo" },
      { type: "completed", usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 2, cacheWriteTokens: null } }
    ]);

    // Request correcta a /chat/completions, stream y Bearer.
    expect(calls[0]!.url).toBe(`${BASE_URL}/chat/completions`);
    const sent = JSON.parse(String(calls[0]!.init.body));
    expect(sent.stream).toBe(true);
    expect(sent.model).toBe("test-model");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${SECRET}`);
  });

  it("emite tool_call.ready con la call correcta cuando el modelo pide una tool", async () => {
    const { adapter } = adapterWith([
      sseResponse([
        JSON.stringify({
          choices: [
            // El proveedor devuelve el nombre SANEADO (sin punto), porque así se lo enviamos.
            { delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "example_search", arguments: '{"q":' } }] } }
          ]
        }),
        JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"aspirina"}' } }] } }]
        }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })
      ])
    ]);

    const tools: ModelToolDefinition[] = [
      { name: "example.search", description: "busca", inputSchema: { type: "object" }, strict: false }
    ];

    const events = await collect(
      adapter.startTurn({
        turnId: "t2",
        model,
        credential: lease,
        messages: userMessage,
        tools,
        options,
        signal: new AbortController().signal
      })
    );

    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.type).toBe("tool_call.ready");
    if (event.type !== "tool_call.ready") {
      throw new Error("se esperaba tool_call.ready");
    }
    expect(event.call.callId).toBe("call_1");
    expect(event.call.name).toBe("example.search");
    expect(event.call.arguments).toEqual({ q: "aspirina" });
    expect(event.continuationState).toBeTruthy();
  });

  it("traduce reasoning_content a reasoning.summary", async () => {
    const { adapter } = adapterWith([
      sseResponse([
        JSON.stringify({ choices: [{ delta: { reasoning_content: "pensando..." } }] }),
        JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } })
      ])
    ]);

    const events = await collect(
      adapter.startTurn({
        turnId: "t3",
        model,
        credential: lease,
        messages: userMessage,
        tools: [],
        options,
        signal: new AbortController().signal
      })
    );

    expect(events[0]).toEqual({ type: "reasoning.summary", summary: "pensando..." });
    expect(events.at(-1)!.type).toBe("completed");
  });
});

describe("OpencodeProviderAdapter.resumeTurn", () => {
  it("tras un tool result, reanuda y completa", async () => {
    // 1) startTurn que pide la tool, para capturar la continuationState real.
    const startAdapter = adapterWith([
      sseResponse([
        JSON.stringify({
          choices: [
            { delta: { tool_calls: [{ index: 0, id: "call_9", function: { name: "example_search", arguments: "{}" } }] } }
          ]
        }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })
      ])
    ]);
    const startEvents = await collect(
      startAdapter.adapter.startTurn({
        turnId: "t4",
        model,
        credential: lease,
        messages: userMessage,
        tools: [{ name: "example.search", description: "busca", inputSchema: {}, strict: false }],
        options,
        signal: new AbortController().signal
      })
    );
    const toolEvent = startEvents[0]!;
    if (toolEvent.type !== "tool_call.ready") {
      throw new Error("se esperaba tool_call.ready");
    }

    // 2) resumeTurn con el resultado de la tool y la continuationState capturada.
    const { adapter, calls } = adapterWith([
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "Listo." } }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 8 } })
      ])
    ]);

    const events = await collect(
      adapter.resumeTurn({
        turnId: "t4",
        model,
        credential: lease,
        toolResults: [{ callId: "call_9", result: { status: "success", content: { hits: 3 } } }],
        continuationState: toolEvent.continuationState ?? null,
        signal: new AbortController().signal
      })
    );

    expect(events).toEqual([
      { type: "text.delta", delta: "Listo." },
      { type: "completed", usage: { inputTokens: 20, outputTokens: 8, cachedInputTokens: null, cacheWriteTokens: null } }
    ]);

    // El historial reenviado incluye el mensaje tool con el tool_call_id correcto.
    const sent = JSON.parse(String(calls[0]!.init.body));
    const toolMsg = sent.messages.at(-1);
    expect(toolMsg.role).toBe("tool");
    expect(toolMsg.tool_call_id).toBe("call_9");
  });

  it("con tool calls PARALELAS drena una a una y solo vuelve al proveedor con todos los resultados", async () => {
    // 1) El modelo pide DOS tools en el mismo mensaje assistant (índices 0 y 1).
    const startAdapter = adapterWith([
      sseResponse([
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "call_a", function: { name: "example_patient_summary", arguments: '{"patient_id":"p1"}' } },
                  { index: 1, id: "call_b", function: { name: "example_search", arguments: '{"q":"labs"}' } }
                ]
              }
            }
          ]
        }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })
      ])
    ]);
    const tools: ModelToolDefinition[] = [
      { name: "example.patient_summary", description: "resumen", inputSchema: {}, strict: false },
      { name: "example.search", description: "busca", inputSchema: {}, strict: false }
    ];
    const startEvents = await collect(
      startAdapter.adapter.startTurn({
        turnId: "t6",
        model,
        credential: lease,
        messages: userMessage,
        tools,
        options,
        signal: new AbortController().signal
      })
    );
    expect(startEvents).toHaveLength(1);
    const firstCall = startEvents[0]!;
    if (firstCall.type !== "tool_call.ready") {
      throw new Error("se esperaba tool_call.ready");
    }
    expect(firstCall.call.callId).toBe("call_a");
    expect(firstCall.call.name).toBe("example.patient_summary");

    // 2) Resultado de la PRIMERA: se despacha la SEGUNDA sin llamar al proveedor.
    const drain = adapterWith([]);
    const drainEvents = await collect(
      drain.adapter.resumeTurn({
        turnId: "t6",
        model,
        credential: lease,
        toolResults: [{ callId: "call_a", result: { status: "success", content: { ok: true } } }],
        continuationState: firstCall.continuationState ?? null,
        signal: new AbortController().signal
      })
    );
    expect(drain.calls).toHaveLength(0);
    expect(drainEvents).toHaveLength(1);
    const secondCall = drainEvents[0]!;
    if (secondCall.type !== "tool_call.ready") {
      throw new Error("se esperaba tool_call.ready");
    }
    expect(secondCall.call.callId).toBe("call_b");
    expect(secondCall.call.name).toBe("example.search");
    expect(secondCall.call.arguments).toEqual({ q: "labs" });

    // 3) Resultado de la SEGUNDA: recién ahora se reanuda con el proveedor, con un mensaje
    // tool por CADA tool_call_id del assistant (lo que DeepSeek exige).
    const { adapter, calls } = adapterWith([
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "Listo." } }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })
      ])
    ]);
    const finalEvents = await collect(
      adapter.resumeTurn({
        turnId: "t6",
        model,
        credential: lease,
        toolResults: [{ callId: "call_b", result: { status: "success", content: { hits: 2 } } }],
        continuationState: secondCall.continuationState ?? null,
        signal: new AbortController().signal
      })
    );
    expect(finalEvents.at(-1)!.type).toBe("completed");

    const sent = JSON.parse(String(calls[0]!.init.body));
    const assistantMsg = sent.messages.find((m: { role: string }) => m.role === "assistant");
    expect(assistantMsg.tool_calls).toHaveLength(2);
    const toolMsgs = sent.messages.filter((m: { role: string }) => m.role === "tool");
    expect(toolMsgs.map((m: { tool_call_id: string }) => m.tool_call_id)).toEqual(["call_a", "call_b"]);
  });

  it("genera un id consistente entre el evento y el historial cuando el proveedor no manda id", async () => {
    const startAdapter = adapterWith([
      sseResponse([
        JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "example_search", arguments: "{}" } }] } }]
        }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })
      ])
    ]);
    const startEvents = await collect(
      startAdapter.adapter.startTurn({
        turnId: "t7",
        model,
        credential: lease,
        messages: userMessage,
        tools: [{ name: "example.search", description: "busca", inputSchema: {}, strict: false }],
        options,
        signal: new AbortController().signal
      })
    );
    const toolEvent = startEvents[0]!;
    if (toolEvent.type !== "tool_call.ready") {
      throw new Error("se esperaba tool_call.ready");
    }
    const state = toolEvent.continuationState as { messages: { role: string; tool_calls?: { id: string }[] }[] };
    const assistantMsg = state.messages.find((m) => m.role === "assistant");
    // El id emitido al cliente y el guardado en el historial deben ser EL MISMO, o el
    // tool_call_id del resultado no casaría al reanudar.
    expect(assistantMsg!.tool_calls![0]!.id).toBe(toolEvent.call.callId);
  });

  it("lanza GatewayError si la continuationState es inválida", async () => {
    const { adapter } = adapterWith([]);
    await expect(
      collect(
        adapter.resumeTurn({
          turnId: "t5",
          model,
          credential: lease,
          toolResults: [],
          continuationState: null,
          signal: new AbortController().signal
        })
      )
    ).rejects.toBeInstanceOf(GatewayError);
  });
});

describe("OpenCode Go (mismo adaptador, provider id distinto)", () => {
  const GO_BASE_URL = "https://opencode.ai/zen/go/v1";

  it("createOpencodeModel modela el id, route y protocol como opencode_go", () => {
    const goModel = createOpencodeModel({
      baseUrl: GO_BASE_URL,
      modelId: "qwen3.7-plus",
      providerId: OPENCODE_GO_PROVIDER_ID
    });
    expect(goModel.id).toBe(`${OPENCODE_GO_PROVIDER_ID}/qwen3.7-plus`);
    expect(goModel.route.providerId).toBe(OPENCODE_GO_PROVIDER_ID);
    expect(goModel.route.protocol).toBe(OPENCODE_GO_PROVIDER_ID);
    expect(goModel.route.endpointBaseUrl).toBe(GO_BASE_URL);
  });

  it("el adaptador Go expone protocol opencode_go y enruta al base URL de Go con Bearer", async () => {
    const calls: Captured[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return jsonResponse({ data: [] });
    }) as unknown as typeof fetch;

    const goAdapter = new OpencodeProviderAdapter({
      baseUrl: GO_BASE_URL,
      providerId: OPENCODE_GO_PROVIDER_ID,
      fetchImpl
    });

    expect(goAdapter.protocol).toBe(OPENCODE_GO_PROVIDER_ID);
    await goAdapter.discoverModels(lease);
    expect(calls[0]!.url).toBe(`${GO_BASE_URL}/models`);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${SECRET}`);
  });

  it("discoverModels del adaptador Go prefija los ids con opencode_go", async () => {
    const calls: Captured[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return jsonResponse({ data: [{ id: "minimax-m3" }] });
    }) as unknown as typeof fetch;

    const goAdapter = new OpencodeProviderAdapter({
      baseUrl: GO_BASE_URL,
      providerId: OPENCODE_GO_PROVIDER_ID,
      fetchImpl
    });

    const models = await goAdapter.discoverModels(lease);
    expect(models[0]!.id).toBe(`${OPENCODE_GO_PROVIDER_ID}/minimax-m3`);
    expect(models[0]!.route.protocol).toBe(OPENCODE_GO_PROVIDER_ID);
  });
});

// Pin de la FORMA EXACTA del request a /chat/completions (MP-CTRL-0077). Estos tests fijan, byte
// a byte, el body que enviamos a opencode, para que cualquier diferencia con lo que el proveedor
// acepta sea visible y no regrese en silencio. Si una QA con key real demuestra que opencode Go
// rechaza un campo, el fix se ancla aquí.
describe("opencode: forma exacta del request a /chat/completions (pin)", () => {
  function bodyOf(calls: Captured[]): Record<string, unknown> {
    return JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
  }

  it("turno simple (sin tools): body canónico, sin tool_choice/reasoning_effort/response_format", async () => {
    const { adapter, calls } = adapterWith([
      sseResponse([JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })])
    ]);
    await collect(
      adapter.startTurn({
        turnId: "t1",
        model,
        credential: lease,
        messages: userMessage,
        tools: [],
        options: { maxOutputTokens: 512, temperature: 0.2 },
        signal: new AbortController().signal
      })
    );
    expect(bodyOf(calls)).toEqual({
      model: "test-model",
      messages: [{ role: "user", content: "Hola" }],
      stream: true,
      max_tokens: 512,
      temperature: 0.2,
      stream_options: { include_usage: true }
    });
  });

  it("turno con tools: agrega tools (type function) y tool_choice 'auto'", async () => {
    const { adapter, calls } = adapterWith([
      sseResponse([JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })])
    ]);
    const tools: ModelToolDefinition[] = [
      { name: "example.search", description: "busca", inputSchema: { type: "object" }, strict: false }
    ];
    await collect(
      adapter.startTurn({
        turnId: "t1",
        model,
        credential: lease,
        messages: userMessage,
        tools,
        options: { maxOutputTokens: 512 },
        signal: new AbortController().signal
      })
    );
    const body = bodyOf(calls);
    expect(body.tool_choice).toBe("auto");
    // El nombre se SANEA al enviarlo (example.search -> example_search): los upstreams
    // estrictos (DeepSeek vía opencode) rechazan el '.' con 400 invalid_request_error.
    expect(body.tools).toEqual([
      { type: "function", function: { name: "example_search", description: "busca", parameters: { type: "object" } } }
    ]);
  });

  it("omite reasoning_effort en modelos sin soporte, y lo incluye (high) cuando el modelo lo soporta", async () => {
    // Modelo sin reasoning (default): se OMITE aunque se pida.
    const plain = adapterWith([
      sseResponse([JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })])
    ]);
    await collect(
      plain.adapter.startTurn({
        turnId: "t1",
        model,
        credential: lease,
        messages: userMessage,
        tools: [],
        options: { maxOutputTokens: 512, reasoningEffort: "high" },
        signal: new AbortController().signal
      })
    );
    expect("reasoning_effort" in bodyOf(plain.calls)).toBe(false);

    // Modelo con reasoning: se envía el nativo (max -> high).
    const reasoningModel = createOpencodeModel({
      baseUrl: BASE_URL,
      modelId: "modelo-r",
      row: { id: "modelo-r", supports_reasoning: true }
    });
    const reason = adapterWith([
      sseResponse([JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })])
    ]);
    await collect(
      reason.adapter.startTurn({
        turnId: "t1",
        model: reasoningModel,
        credential: lease,
        messages: userMessage,
        tools: [],
        options: { maxOutputTokens: 512, reasoningEffort: "max" },
        signal: new AbortController().signal
      })
    );
    expect(bodyOf(reason.calls).reasoning_effort).toBe("high");
  });

  it("DIAGNÓSTICO: ante un error del proveedor, surface el status y el cuerpo de error", async () => {
    const { adapter } = adapterWith([
      jsonResponse(
        {
          error: {
            message: "Unsupported parameter: stream_options",
            type: "invalid_request_error",
            param: "stream_options",
            code: "unsupported_parameter"
          }
        },
        400
      )
    ]);
    let caught: unknown;
    try {
      await collect(
        adapter.startTurn({
          turnId: "t1",
          model,
          credential: lease,
          messages: userMessage,
          tools: [],
          options,
          signal: new AbortController().signal
        })
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GatewayError);
    const gatewayError = caught as GatewayError;
    expect(gatewayError.code).toBe("PROVIDER_REQUEST_FAILED");
    const details = gatewayError.details as { providerStatus?: number; providerError?: string };
    expect(details.providerStatus).toBe(400);
    expect(details.providerError).toContain("stream_options");
    // El mensaje del error también lleva la pista upstream (para QA).
    expect(gatewayError.message).toContain("stream_options");
  });
});

type WireMsg = Parameters<typeof normalizeToolSequence>[0][number];

describe("normalizeToolSequence: repara el invariante tool_calls↔tool antes de enviar (Fix 400)", () => {
  const assistant = (calls: { id: string; name?: string }[], content: string | null = null): WireMsg => ({
    role: "assistant",
    content,
    tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name ?? "t", arguments: "{}" } }))
  });
  const toolMsg = (id: string): WireMsg => ({ role: "tool", tool_call_id: id, content: "{}" });

  it("no-op en el camino feliz (cada tool_call tiene su tool)", () => {
    const messages: WireMsg[] = [
      { role: "user", content: "hola" },
      assistant([{ id: "call_a" }, { id: "call_b" }]),
      toolMsg("call_a"),
      toolMsg("call_b")
    ];
    expect(normalizeToolSequence(messages)).toEqual(messages);
  });

  it("descarta un tool_call SIN respuesta (turno muerto a mitad del drenado paralelo)", () => {
    // assistant declara 2 tool_calls pero sólo llegó 1 mensaje tool → 400 en DeepSeek.
    const out = normalizeToolSequence([
      assistant([{ id: "call_a" }, { id: "call_b" }]),
      toolMsg("call_a")
    ]);
    const asst = out.find((m) => m.role === "assistant")!;
    expect(asst.tool_calls!.map((c) => c.id)).toEqual(["call_a"]);
    expect(out.filter((m) => m.role === "tool")).toHaveLength(1);
  });

  it("deduplica tool_calls con id repetido (conserva el primero y su único tool)", () => {
    const out = normalizeToolSequence([
      assistant([{ id: "call_a" }, { id: "call_a" }]),
      toolMsg("call_a")
    ]);
    const asst = out.find((m) => m.role === "assistant")!;
    expect(asst.tool_calls!).toHaveLength(1);
    expect(out.filter((m) => m.role === "tool")).toHaveLength(1);
  });

  it("si ningún tool_call quedó respondido conserva el assistant como texto (o lo descarta)", () => {
    // Con texto: se conserva como mensaje de texto (sin tool_calls).
    const withText = normalizeToolSequence([assistant([{ id: "call_a" }], "Voy a buscar…")]);
    expect(withText).toEqual([{ role: "assistant", content: "Voy a buscar…" }]);
    // Sin texto: se descarta entero (no deja un assistant vacío con tool_calls colgando).
    const noText = normalizeToolSequence([assistant([{ id: "call_a" }], null)]);
    expect(noText).toEqual([]);
  });

  it("descarta mensajes tool HUÉRFANOS (sin assistant con tool_calls que los preceda)", () => {
    const out = normalizeToolSequence([{ role: "user", content: "hola" }, toolMsg("call_x")]);
    expect(out).toEqual([{ role: "user", content: "hola" }]);
  });
});

describe("opencode: señal de truncamiento (Fix mensaje cortado)", () => {
  async function completedEventFor(finishReason: string | null): Promise<ProviderEvent> {
    const chunks = [JSON.stringify({ choices: [{ delta: { content: "Permítame retomar. U" } }] })];
    if (finishReason !== null) {
      chunks.push(JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] }));
    }
    const { adapter } = adapterWith([sseResponse(chunks)]);
    const events = await collect(
      adapter.startTurn({
        turnId: "tt",
        model,
        credential: lease,
        messages: userMessage,
        tools: [],
        options,
        signal: new AbortController().signal
      })
    );
    return events.at(-1)!;
  }

  it("marca truncated=true con finish_reason 'length'", async () => {
    const completed = await completedEventFor("length");
    expect(completed).toMatchObject({ type: "completed", truncated: true });
  });

  it("marca truncated=true si el stream terminó con texto y SIN finish_reason", async () => {
    const completed = await completedEventFor(null);
    expect(completed).toMatchObject({ type: "completed", truncated: true });
  });

  it("no marca truncated en un cierre limpio (finish_reason 'stop')", async () => {
    const completed = await completedEventFor("stop");
    expect(completed.type).toBe("completed");
    expect("truncated" in completed).toBe(false);
  });
});
