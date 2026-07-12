import { describe, expect, it } from "vitest";
import {
  honorReasoningEffort,
  isNormalizedReasoningEffort,
  nativeReasoningEffort
} from "../../src/domain/reasoning.js";
import type { ProviderProtocol } from "../../src/domain/model.js";

describe("reasoning: escala normalizada", () => {
  it("reconoce los niveles válidos y rechaza el resto", () => {
    for (const level of ["off", "low", "medium", "high", "max"]) {
      expect(isNormalizedReasoningEffort(level)).toBe(true);
    }
    expect(isNormalizedReasoningEffort("xhigh")).toBe(false);
    expect(isNormalizedReasoningEffort("minimal")).toBe(false);
    expect(isNormalizedReasoningEffort(undefined)).toBe(false);
  });
});

describe("reasoning: honorReasoningEffort (gate)", () => {
  it("omite (null) cuando el modelo no lo soporta", () => {
    expect(honorReasoningEffort("high", false)).toBeNull();
  });

  it("omite (null) cuando el nivel es 'off'", () => {
    expect(honorReasoningEffort("off", true)).toBeNull();
  });

  it("omite (null) cuando no hay nivel", () => {
    expect(honorReasoningEffort(undefined, true)).toBeNull();
  });

  it("devuelve el nivel cuando está soportado y no es off", () => {
    expect(honorReasoningEffort("medium", true)).toBe("medium");
  });
});

describe("reasoning: nativeReasoningEffort (mapeo por proveedor)", () => {
  const openAiFamily: ProviderProtocol[] = [
    "openai",
    "opencode_zen",
    "opencode_go",
    "openai_chat_completions"
  ];

  it("mapea low/medium/high directo en la familia OpenAI-compatible", () => {
    for (const protocol of openAiFamily) {
      expect(nativeReasoningEffort(protocol, "low")).toBe("low");
      expect(nativeReasoningEffort(protocol, "medium")).toBe("medium");
      expect(nativeReasoningEffort(protocol, "high")).toBe("high");
    }
  });

  it("mapea 'max' al máximo nativo documentado ('high')", () => {
    for (const protocol of openAiFamily) {
      expect(nativeReasoningEffort(protocol, "max")).toBe("high");
    }
  });

  it("omite (null) para 'off' o nivel ausente", () => {
    expect(nativeReasoningEffort("openai", "off")).toBeNull();
    expect(nativeReasoningEffort("openai", null)).toBeNull();
    expect(nativeReasoningEffort("openai", undefined)).toBeNull();
  });

  it("omite (null) para proveedores sin razonamiento por effort", () => {
    expect(nativeReasoningEffort("anthropic_messages", "high")).toBeNull();
    expect(nativeReasoningEffort("gemini_generate_content", "high")).toBeNull();
    expect(nativeReasoningEffort("fake", "high")).toBeNull();
  });
});
