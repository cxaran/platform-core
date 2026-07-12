import { describe, expect, it } from "vitest";
import { negotiateCapabilities } from "../../src/application/capabilities/capability-negotiator.js";
import { createFakeModel } from "../../src/domain/model.js";

const policy = {
  tools: true,
  structuredOutput: true,
  reasoning: true,
  images: false,
  audio: false
};

describe("capability negotiator", () => {
  it("rejects tools when model toolCalling is unsupported", () => {
    const base = createFakeModel();
    const model = createFakeModel({
      capabilities: {
        ...base.capabilities,
        toolCalling: { ...base.capabilities.toolCalling, support: "unsupported" }
      }
    });

    expect(() =>
      negotiateCapabilities({
        model,
        policy,
        tools: [{ name: "example.test", description: "test", inputSchema: {}, strict: false }],
        generation: { maxOutputTokens: 100 }
      })
    ).toThrow("Tool calling is not supported");
  });

  it("rechaza imágenes cuando el modelo es text-only (inputModalities sin image)", () => {
    const model = createFakeModel(); // text-only por defecto
    expect(() =>
      negotiateCapabilities({
        model,
        policy: { ...policy, images: true },
        tools: [],
        generation: { maxOutputTokens: 100 },
        hasImageContent: true
      })
    ).toThrow("Image input is not supported");
  });

  it("rechaza imágenes cuando la política las deshabilita", () => {
    const base = createFakeModel();
    const model = createFakeModel({
      capabilities: { ...base.capabilities, inputModalities: new Set(["text", "image"]) }
    });
    expect(() =>
      negotiateCapabilities({
        model,
        policy: { ...policy, images: false },
        tools: [],
        generation: { maxOutputTokens: 100 },
        hasImageContent: true
      })
    ).toThrow("Image input is disabled");
  });

  it("acepta imágenes cuando el modelo tiene visión y la política lo permite", () => {
    const base = createFakeModel();
    const model = createFakeModel({
      capabilities: { ...base.capabilities, inputModalities: new Set(["text", "image"]) }
    });
    expect(() =>
      negotiateCapabilities({
        model,
        policy: { ...policy, images: true },
        tools: [],
        generation: { maxOutputTokens: 100 },
        hasImageContent: true
      })
    ).not.toThrow();
  });

  it("rejects strict JSON Schema when unsupported", () => {
    const base = createFakeModel();
    const model = createFakeModel({
      capabilities: {
        ...base.capabilities,
        structuredOutput: { ...base.capabilities.structuredOutput, strictSchema: "unsupported" }
      }
    });

    expect(() =>
      negotiateCapabilities({
        model,
        policy,
        tools: [],
        generation: { maxOutputTokens: 100, responseFormat: "json_schema", strictJsonSchema: true }
      })
    ).toThrow("Strict JSON Schema output is not supported");
  });
});
