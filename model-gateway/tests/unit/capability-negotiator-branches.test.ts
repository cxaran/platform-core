import { describe, expect, it } from "vitest";
import {
  negotiateCapabilities,
  type CapabilityPolicy
} from "../../src/application/capabilities/capability-negotiator.js";
import { createFakeModel } from "../../src/domain/model.js";
import { GatewayError } from "../../src/kernel/errors.js";
import type { ModelToolDefinition } from "../../src/domain/tool.js";

const fullPolicy: CapabilityPolicy = {
  tools: true,
  structuredOutput: true,
  reasoning: true,
  images: false,
  audio: false
};

function tool(overrides: Partial<ModelToolDefinition> = {}): ModelToolDefinition {
  return { name: "example.test", description: "test", inputSchema: {}, strict: false, ...overrides };
}

// Modelo con capacidades nested sobreescritas (createFakeModel reemplaza capabilities
// completo, por eso se parte de base.capabilities).
function modelWith(capsOverride: Record<string, unknown>) {
  const base = createFakeModel();
  return createFakeModel({ capabilities: { ...base.capabilities, ...capsOverride } });
}

function expectGatewayError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as GatewayError).code).toBe(code);
    return;
  }
  throw new Error(`Se esperaba un GatewayError con code=${code}`);
}

describe("negotiateCapabilities: camino feliz", () => {
  it("devuelve tools y generation sin alterarlos cuando todo es soportado", () => {
    const tools = [tool({ strict: true })];
    const generation = {
      maxOutputTokens: 1000,
      responseFormat: "json_schema" as const,
      strictJsonSchema: true
    };
    const result = negotiateCapabilities({
      model: createFakeModel(),
      tools,
      generation,
      policy: fullPolicy
    });
    expect(result.tools).toBe(tools);
    expect(result.generation).toBe(generation);
  });

  it("honra un effort de reasoning cuando el modelo lo soporta", () => {
    const model = modelWith({
      reasoning: { support: "supported", allowedEfforts: ["low", "high"], summaryOutput: "unsupported" }
    });
    const result = negotiateCapabilities({
      model,
      tools: [],
      generation: { maxOutputTokens: 100, reasoningEffort: "high" },
      policy: fullPolicy
    });
    expect(result.generation.reasoningEffort).toBe("high");
  });

  it("honra 'max' (nivel normalizado máximo) cuando el modelo soporta razonamiento", () => {
    const model = modelWith({
      reasoning: { support: "supported", allowedEfforts: ["low", "medium", "high"], summaryOutput: "unsupported" }
    });
    const result = negotiateCapabilities({
      model,
      tools: [],
      generation: { maxOutputTokens: 100, reasoningEffort: "max" },
      policy: fullPolicy
    });
    // El negociador conserva el nivel NORMALIZADO; el mapeo a nativo ocurre en el adaptador.
    expect(result.generation.reasoningEffort).toBe("max");
  });
});

describe("negotiateCapabilities: razonamiento (P5) se OMITE, no se rechaza", () => {
  it("omite el effort cuando la policy del perfil deshabilita razonamiento", () => {
    const model = modelWith({
      reasoning: { support: "supported", allowedEfforts: ["low", "high"], summaryOutput: "unsupported" }
    });
    const result = negotiateCapabilities({
      model,
      tools: [],
      generation: { maxOutputTokens: 100, reasoningEffort: "high" },
      policy: { ...fullPolicy, reasoning: false }
    });
    expect(result.generation.reasoningEffort).toBeUndefined();
  });

  it("omite el effort cuando el modelo no soporta razonamiento", () => {
    // El fake por defecto tiene reasoning.support = "unsupported".
    const result = negotiateCapabilities({
      model: createFakeModel(),
      tools: [],
      generation: { maxOutputTokens: 100, reasoningEffort: "high" },
      policy: fullPolicy
    });
    expect(result.generation.reasoningEffort).toBeUndefined();
  });

  it("omite el effort cuando el nivel es 'off' aunque el modelo lo soporte", () => {
    const model = modelWith({
      reasoning: { support: "supported", allowedEfforts: ["low", "high"], summaryOutput: "unsupported" }
    });
    const result = negotiateCapabilities({
      model,
      tools: [],
      generation: { maxOutputTokens: 100, reasoningEffort: "off" },
      policy: fullPolicy
    });
    expect(result.generation.reasoningEffort).toBeUndefined();
  });
});

describe("negotiateCapabilities: rechazos por POLICY (CAPABILITY_NOT_ALLOWED)", () => {
  it("tools deshabilitadas por la policy del perfil", () => {
    expectGatewayError(
      () =>
        negotiateCapabilities({
          model: createFakeModel(),
          tools: [tool()],
          generation: { maxOutputTokens: 100 },
          policy: { ...fullPolicy, tools: false }
        }),
      "CAPABILITY_NOT_ALLOWED"
    );
  });

  it("structured output deshabilitado por la policy del perfil", () => {
    expectGatewayError(
      () =>
        negotiateCapabilities({
          model: createFakeModel(),
          tools: [],
          generation: { maxOutputTokens: 100, responseFormat: "json_schema" },
          policy: { ...fullPolicy, structuredOutput: false }
        }),
      "CAPABILITY_NOT_ALLOWED"
    );
  });
});

describe("negotiateCapabilities: rechazos por MODELO (CAPABILITY_UNSUPPORTED)", () => {
  it("strict tool schema no soportado por el modelo", () => {
    const model = modelWith({
      toolCalling: { support: "supported", strictSchema: "unsupported", parallelCalls: "unsupported" }
    });
    expectGatewayError(
      () =>
        negotiateCapabilities({
          model,
          tools: [tool({ strict: true })],
          generation: { maxOutputTokens: 100 },
          policy: fullPolicy
        }),
      "CAPABILITY_UNSUPPORTED"
    );
  });

  it("JSON Schema output no soportado por el modelo", () => {
    const model = modelWith({
      structuredOutput: { jsonObject: "supported", jsonSchema: "unsupported", strictSchema: "supported" }
    });
    expectGatewayError(
      () =>
        negotiateCapabilities({
          model,
          tools: [],
          generation: { maxOutputTokens: 100, responseFormat: "json_schema" },
          policy: fullPolicy
        }),
      "CAPABILITY_UNSUPPORTED"
    );
  });

});

describe("negotiateCapabilities: límite de salida", () => {
  it("rechaza maxOutputTokens por encima del límite del modelo (OUTPUT_LIMIT_EXCEEDED)", () => {
    // El fake por defecto tiene maxOutputTokens = 4096.
    expectGatewayError(
      () =>
        negotiateCapabilities({
          model: createFakeModel(),
          tools: [],
          generation: { maxOutputTokens: 5000 },
          policy: fullPolicy
        }),
      "OUTPUT_LIMIT_EXCEEDED"
    );
  });

  it("acepta maxOutputTokens dentro del límite del modelo", () => {
    const result = negotiateCapabilities({
      model: createFakeModel(),
      tools: [],
      generation: { maxOutputTokens: 4096 },
      policy: fullPolicy
    });
    expect(result.generation.maxOutputTokens).toBe(4096);
  });
});
