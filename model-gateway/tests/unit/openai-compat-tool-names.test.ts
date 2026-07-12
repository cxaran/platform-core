import { describe, expect, it } from "vitest";
import {
  buildOACToolNameMap,
  sanitizeOACMessageToolCalls,
  sanitizeOACToolName,
  sanitizeOACTools,
  type OACMessage,
  type OACTool,
  type OpenAICompatChatContinuation
} from "../../src/providers/openai-compat/chat.js";
import { OpenAIProviderAdapter, createOpenAIModel } from "../../src/providers/openai/adapter.js";
import type { GenerationOptions } from "../../src/application/capabilities/capability-negotiator.js";
import type { CanonicalMessage } from "../../src/domain/message.js";
import type { ModelToolDefinition } from "../../src/domain/tool.js";
import type { ProviderCredentialLease, ProviderEvent } from "../../src/ports/provider-adapter.port.js";

// SANEO DE NOMBRES DE TOOL EN EL CABLE chat/completions (regresión del 400 de DeepSeek:
// "Invalid 'tools[0].function.name' ... pattern '^[a-zA-Z0-9_-]+$'"). Nuestros namespaces
// llevan punto ("example.search_patients", "ui.render_form"); el cable debe ir saneado y
// la tool call emitida al navegador debe REVERTIR al nombre original. La continuación
// conserva nombres originales y se re-sanea al reanudar.

const WIRE_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

const BASE_URL = "https://openai.test/v1";

const lease: ProviderCredentialLease = {
  leaseId: "lease-1",
  secret: "sk-leased-xyz",
  expiresAt: new Date(Date.now() + 60_000)
};

const options: GenerationOptions = { maxOutputTokens: 256 };

const userMessage: CanonicalMessage[] = [
  { role: "user", content: [{ type: "text", text: "Busca al registro" }] }
];

const tools: ModelToolDefinition[] = [
  {
    name: "example.search_patients",
    description: "Busca registros",
    inputSchema: { type: "object" },
    strict: false
  },
  { name: "ui.render_form", description: "Formulario", inputSchema: { type: "object" }, strict: false }
];

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

function adapterWith(responses: Response[]): {
  adapter: OpenAIProviderAdapter;
  calls: { url: string; init: RequestInit }[];
} {
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
  return {
    adapter: new OpenAIProviderAdapter({ baseUrl: BASE_URL, apiFlavor: "chat_completions", fetchImpl }),
    calls
  };
}

async function collect(iterable: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

describe("saneo de nombres de tool (helpers)", () => {
  it("sanea el punto y trunca a 64 (patrón de OpenAI/DeepSeek)", () => {
    expect(sanitizeOACToolName("example.search_patients")).toBe("example_search_patients");
    expect(sanitizeOACToolName("ui.render_form")).toMatch(WIRE_NAME_PATTERN);
    expect(sanitizeOACToolName("a".repeat(80)).length).toBe(64);
    // Un nombre ya válido queda intacto.
    expect(sanitizeOACToolName("tool_search")).toBe("tool_search");
  });

  it("buildOACToolNameMap permite el round-trip saneado -> original", () => {
    const wire: OACTool[] = [
      { type: "function", function: { name: "example.search_patients", description: "d", parameters: {} } }
    ];
    const map = buildOACToolNameMap(wire);
    expect(map["example_search_patients"]).toBe("example.search_patients");
  });

  it("sanitizeOACTools/sanitizeOACMessageToolCalls sanean el cable sin mutar la entrada", () => {
    const wire: OACTool[] = [
      { type: "function", function: { name: "ui.render_form", description: "d", parameters: {} } }
    ];
    const sanitized = sanitizeOACTools(wire);
    expect(sanitized[0]!.function.name).toBe("ui_render_form");
    expect(wire[0]!.function.name).toBe("ui.render_form");

    const messages: OACMessage[] = [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "ui.render_form", arguments: "{}" } }
        ]
      }
    ];
    const out = sanitizeOACMessageToolCalls(messages);
    expect(out[0]!.tool_calls![0]!.function.name).toBe("ui_render_form");
    expect(messages[0]!.tool_calls![0]!.function.name).toBe("ui.render_form");
  });
});

describe("runOpenAICompatChat: nombres saneados en el cable, originales hacia el cliente", () => {
  const model = createOpenAIModel({ baseUrl: BASE_URL, modelId: "gpt-4o" });

  it("declara tools saneadas, revierte el nombre en tool_call.ready y conserva originales en la continuación", async () => {
    const { adapter, calls } = adapterWith([
      sseResponse([
        // El proveedor emite el nombre SANEADO (es el que se le declaró).
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "call_1", function: { name: "example_search_patients", arguments: "{}" } },
                  { index: 1, id: "call_2", function: { name: "ui_render_form", arguments: "{}" } }
                ]
              }
            }
          ]
        }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })
      ])
    ]);

    const events = await collect(
      adapter.startTurn({
        turnId: "t1",
        model,
        credential: lease,
        messages: userMessage,
        tools,
        options,
        signal: new AbortController().signal
      })
    );

    // Cable: TODOS los nombres declarados cumplen el patrón estricto (sin '.').
    const sentBody = JSON.parse(String(calls[0]!.init.body)) as {
      tools: { function: { name: string } }[];
    };
    expect(sentBody.tools.map((t) => t.function.name)).toEqual([
      "example_search_patients",
      "ui_render_form"
    ]);
    for (const tool of sentBody.tools) {
      expect(tool.function.name).toMatch(WIRE_NAME_PATTERN);
    }

    // Evento al navegador: el nombre ORIGINAL (con '.') que conoce el registro de tools.
    const event = events[0]!;
    expect(event.type).toBe("tool_call.ready");
    if (event.type !== "tool_call.ready") {
      throw new Error("se esperaba tool_call.ready");
    }
    expect(event.call.name).toBe("example.search_patients");

    // Continuación: historial y pendientes con nombres ORIGINALES (se re-sanean al reenviar).
    const state = event.continuationState as OpenAICompatChatContinuation;
    const assistant = state.messages.at(-1)!;
    expect(assistant.tool_calls!.map((c) => c.function.name)).toEqual([
      "example.search_patients",
      "ui.render_form"
    ]);
    expect(state.pendingCalls?.map((c) => c.name)).toEqual(["ui.render_form"]);
  });

  it("al reanudar, re-sanea los tool_calls del historial y drena la paralela con nombre original", async () => {
    // 1) startTurn con dos tool calls paralelas (captura la continuación real).
    const start = adapterWith([
      sseResponse([
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "call_1", function: { name: "example_search_patients", arguments: "{}" } },
                  { index: 1, id: "call_2", function: { name: "ui_render_form", arguments: "{}" } }
                ]
              }
            }
          ]
        }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })
      ])
    ]);
    const startEvents = await collect(
      start.adapter.startTurn({
        turnId: "t2",
        model,
        credential: lease,
        messages: userMessage,
        tools,
        options,
        signal: new AbortController().signal
      })
    );
    const firstEvent = startEvents[0]!;
    if (firstEvent.type !== "tool_call.ready") {
      throw new Error("se esperaba tool_call.ready");
    }

    // 2) Primer resume: aún queda una paralela -> se emite al navegador con el nombre ORIGINAL,
    //    sin llamar al proveedor.
    const drain = adapterWith([]);
    const drainEvents = await collect(
      drain.adapter.resumeTurn({
        turnId: "t2",
        model,
        credential: lease,
        toolResults: [{ callId: "call_1", result: { status: "success", content: { ok: true } } }],
        continuationState: firstEvent.continuationState ?? null,
        signal: new AbortController().signal
      })
    );
    expect(drain.calls).toHaveLength(0);
    const nextEvent = drainEvents[0]!;
    if (nextEvent.type !== "tool_call.ready") {
      throw new Error("se esperaba tool_call.ready de la paralela pendiente");
    }
    expect(nextEvent.call.name).toBe("ui.render_form");

    // 3) Segundo resume (todas con resultado): vuelve al proveedor con el historial re-saneado.
    const finish = adapterWith([
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "Listo." }, finish_reason: "stop" }] })
      ])
    ]);
    await collect(
      finish.adapter.resumeTurn({
        turnId: "t2",
        model,
        credential: lease,
        toolResults: [{ callId: "call_2", result: { status: "success", content: { ok: true } } }],
        continuationState: nextEvent.continuationState ?? null,
        signal: new AbortController().signal
      })
    );
    const resumeBody = JSON.parse(String(finish.calls[0]!.init.body)) as {
      messages: OACMessage[];
      tools: { function: { name: string } }[];
    };
    const assistantWire = resumeBody.messages.find((m) => m.role === "assistant" && m.tool_calls);
    expect(assistantWire!.tool_calls!.map((c) => c.function.name)).toEqual([
      "example_search_patients",
      "ui_render_form"
    ]);
    for (const tool of resumeBody.tools) {
      expect(tool.function.name).toMatch(WIRE_NAME_PATTERN);
    }
  });
});
