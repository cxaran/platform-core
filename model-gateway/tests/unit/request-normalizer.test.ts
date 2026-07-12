import { describe, expect, it } from "vitest";
import {
  estimateSystemTokens,
  estimateToolSchemaTokens
} from "../../src/application/capabilities/request-normalizer.js";
import type { ModelToolDefinition } from "../../src/domain/tool.js";
import type { CanonicalMessage } from "../../src/domain/message.js";

function tool(overrides: Partial<ModelToolDefinition> = {}): ModelToolDefinition {
  return {
    name: "search",
    description: "Busca",
    inputSchema: { type: "object" },
    strict: true,
    ...overrides
  };
}

describe("estimateToolSchemaTokens", () => {
  it("una lista vacía estima ceil('[]'.length / 4) = 1", () => {
    expect(estimateToolSchemaTokens([])).toBe(1);
  });

  it("estima ceil(JSON.stringify(tools).length / 4) y crece con el contenido", () => {
    const tools = [tool(), tool({ name: "fetch" })];
    const expected = Math.ceil(JSON.stringify(tools).length / 4);
    expect(estimateToolSchemaTokens(tools)).toBe(expected);
    expect(estimateToolSchemaTokens(tools)).toBeGreaterThan(estimateToolSchemaTokens([]));
  });
});

describe("estimateSystemTokens", () => {
  it("cuenta solo los mensajes 'system' (ignora user/assistant/tool)", () => {
    const messages: CanonicalMessage[] = [
      { role: "system", content: [{ type: "text", text: "abcd" }] }, // 4 chars
      { role: "user", content: [{ type: "text", text: "texto largo ignorado" }] },
      { role: "assistant", content: [{ type: "text", text: "tambien ignorado" }] }
    ];
    // total = 4 -> ceil(4/4) = 1
    expect(estimateSystemTokens(messages)).toBe(1);
  });

  it("suma texto (.text) y binario (.data) de partes en mensajes system", () => {
    const messages: CanonicalMessage[] = [
      { role: "system", content: [{ type: "text", text: "abcd" }] }, // 4
      {
        role: "system",
        content: [{ type: "image", mimeType: "image/png", data: "xxxxxxxx" }] // 8 (data)
      }
    ];
    // total = 12 -> ceil(12/4) = 3
    expect(estimateSystemTokens(messages)).toBe(3);
  });

  it("sin mensajes system devuelve 0", () => {
    const messages: CanonicalMessage[] = [
      { role: "user", content: [{ type: "text", text: "hola" }] }
    ];
    expect(estimateSystemTokens(messages)).toBe(0);
    expect(estimateSystemTokens([])).toBe(0);
  });
});
