import { describe, expect, it } from "vitest";
import { parseClientMessage } from "../../src/transport/websocket/protocol.parser.js";

function validStart(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "turn.start",
    request_id: "req-1",
    profile_id: "prof-1",
    messages: [{ role: "user", content: [{ type: "text", text: "hola" }] }],
    generation: { max_output_tokens: 100 },
    ...overrides
  };
}

describe("parseClientMessage: frontera del protocolo", () => {
  it("rechaza valores sin un campo 'type'", () => {
    expect(() => parseClientMessage(null)).toThrow("must contain a type");
    expect(() => parseClientMessage(42)).toThrow("must contain a type");
    expect(() => parseClientMessage({})).toThrow("must contain a type");
  });

  it("rechaza un tipo desconocido", () => {
    expect(() => parseClientMessage({ type: "turn.cancel" })).toThrow(
      "Unknown WebSocket message type"
    );
  });

  it("rechaza un string JSON inválido (JSON.parse lanza)", () => {
    expect(() => parseClientMessage("{ no es json")).toThrow();
  });

  it("acepta entrada como string JSON y la parsea", () => {
    const parsed = parseClientMessage(JSON.stringify(validStart()));
    expect(parsed.kind).toBe("turn.start");
  });
});

describe("parseClientMessage: turn.start", () => {
  it("mapea snake_case a camelCase y aplica tools por defecto []", () => {
    const parsed = parseClientMessage(validStart());
    expect(parsed).toEqual({
      kind: "turn.start",
      request: {
        requestId: "req-1",
        profileId: "prof-1",
        messages: [{ role: "user", content: [{ type: "text", text: "hola" }] }],
        tools: [],
        generation: { maxOutputTokens: 100 }
      }
    });
  });

  it("mapea todos los campos opcionales de generation cuando vienen presentes", () => {
    const parsed = parseClientMessage(
      validStart({
        generation: {
          max_output_tokens: 200,
          temperature: 0.5,
          reasoning_effort: "high",
          response_format: "json_object",
          strict_json_schema: true
        }
      })
    );
    if (parsed.kind !== "turn.start") throw new Error("esperado turn.start");
    expect(parsed.request.generation).toEqual({
      maxOutputTokens: 200,
      temperature: 0.5,
      reasoningEffort: "high",
      responseFormat: "json_object",
      strictJsonSchema: true
    });
  });

  it("no agrega campos opcionales de generation que no vinieron", () => {
    const parsed = parseClientMessage(validStart());
    if (parsed.kind !== "turn.start") throw new Error("esperado turn.start");
    expect(parsed.request.generation).toEqual({ maxOutputTokens: 100 });
    expect("temperature" in parsed.request.generation).toBe(false);
  });

  it("mapea las tools (input_schema -> inputSchema)", () => {
    const parsed = parseClientMessage(
      validStart({
        tools: [
          { name: "search", description: "Busca", input_schema: { type: "object" }, strict: true }
        ]
      })
    );
    if (parsed.kind !== "turn.start") throw new Error("esperado turn.start");
    expect(parsed.request.tools).toEqual([
      { name: "search", description: "Busca", inputSchema: { type: "object" }, strict: true }
    ]);
  });

  it("rechaza turn.start con campos requeridos ausentes (profile_id)", () => {
    const broken = validStart();
    delete broken.profile_id;
    expect(() => parseClientMessage(broken)).toThrow();
  });

  it("rechaza turn.start con messages vacío (minItems 1)", () => {
    expect(() => parseClientMessage(validStart({ messages: [] }))).toThrow();
  });

  it("acepta una parte de imagen y la mapea tal cual al dominio (mimeType/data)", () => {
    const parsed = parseClientMessage(
      validStart({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "describe esta imagen" },
              { type: "image", mimeType: "image/png", data: "QUJD" }
            ]
          }
        ]
      })
    );
    if (parsed.kind !== "turn.start") throw new Error("esperado turn.start");
    expect(parsed.request.messages[0]!.content).toEqual([
      { type: "text", text: "describe esta imagen" },
      { type: "image", mimeType: "image/png", data: "QUJD" }
    ]);
  });

  it("rechaza una parte de imagen sin data (minLength 1)", () => {
    expect(() =>
      parseClientMessage(
        validStart({
          messages: [{ role: "user", content: [{ type: "image", mimeType: "image/png", data: "" }] }]
        })
      )
    ).toThrow();
  });

  it("rechaza turn.start con temperature fuera de rango (> 2)", () => {
    expect(() =>
      parseClientMessage(validStart({ generation: { max_output_tokens: 10, temperature: 3 } }))
    ).toThrow();
  });
});

describe("parseClientMessage: turn.tool_result", () => {
  it("mapea un resultado de tool exitoso", () => {
    const parsed = parseClientMessage({
      type: "turn.tool_result",
      turn_id: "t1",
      call_id: "c1",
      result: { status: "success", content: { rows: 3 } }
    });
    expect(parsed).toEqual({
      kind: "turn.tool_result",
      turnId: "t1",
      result: { callId: "c1", result: { status: "success", content: { rows: 3 } } }
    });
  });

  it("mapea un resultado de tool con error", () => {
    const parsed = parseClientMessage({
      type: "turn.tool_result",
      turn_id: "t1",
      call_id: "c1",
      result: { status: "error", code: "boom", message: "falló" }
    });
    if (parsed.kind !== "turn.tool_result") throw new Error("esperado turn.tool_result");
    expect(parsed.result.result).toEqual({ status: "error", code: "boom", message: "falló" });
  });

  it("rechaza turn.tool_result con call_id ausente", () => {
    expect(() =>
      parseClientMessage({
        type: "turn.tool_result",
        turn_id: "t1",
        result: { status: "success", content: {} }
      })
    ).toThrow();
  });
});
