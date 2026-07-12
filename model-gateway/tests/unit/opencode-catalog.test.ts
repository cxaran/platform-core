import { describe, expect, it } from "vitest";
import { createOpencodeModel } from "../../src/providers/opencode/adapter.js";
import { OPENCODE_CURATED, opencodeCuratedFor, type OpencodeCuratedEntry } from "../../src/providers/opencode/catalog.js";
import type { ModelPricing } from "../../src/domain/model.js";

const BASE_URL = "https://opencode.test/v1";

// Tarifa curada sintética para probar el MECANISMO de precedencia (no es el mapa real).
const CURATED: OpencodeCuratedEntry = {
  contextWindowTokens: 50000,
  maxOutputTokens: 2048,
  supportsTools: false,
  supportsReasoning: true,
  vision: true,
  pricing: {
    currency: "USD",
    promptPerToken: 0.000001,
    completionPerToken: 0.000002,
    cacheReadPerToken: null,
    cacheWritePerToken: null,
  },
};

describe("opencode: mapa curado (capacidades + precios)", () => {
  it("el mapa real sólo trae valores documentables (tier gratuito -> precio 0)", () => {
    const free = opencodeCuratedFor("minimax-m3-free");
    expect(free?.pricing?.promptPerToken).toBe(0);
    expect(free?.pricing?.completionPerToken).toBe(0);
    // Un modelo de pago NO está curado con precio (honesto: no se inventa).
    expect(opencodeCuratedFor("qwen3.7-plus")).toBeUndefined();
  });

  it("enriquece campos DESCONOCIDOS cuando no hay row (todo del curado)", () => {
    const model = createOpencodeModel({ baseUrl: BASE_URL, modelId: "x-model", curated: CURATED });
    expect(model.capabilities.contextWindowTokens).toBe(50000);
    expect(model.capabilities.maxOutputTokens).toBe(2048);
    expect(model.capabilities.compat.supportsTools).toBe(false);
    expect(model.capabilities.compat.supportsReasoningEffort).toBe(true);
    expect(model.capabilities.inputModalities.has("image")).toBe(true);
    expect(model.pricing?.promptPerToken).toBe(0.000001);
    expect(model.enrichment).toEqual({ capabilities: "curated", pricing: "curated" });
  });

  it("el metadato REAL del proveedor NO se sobrescribe con el curado (provider gana)", () => {
    const row = {
      id: "x-model",
      context_length: 128000,
      max_output_tokens: 8192,
      supports_tools: true,
      supports_reasoning: false,
      modalities: ["text"],
    };
    const model = createOpencodeModel({ baseUrl: BASE_URL, modelId: "x-model", row, curated: CURATED });
    // Todos los valores del proveedor ganan sobre el curado.
    expect(model.capabilities.contextWindowTokens).toBe(128000);
    expect(model.capabilities.maxOutputTokens).toBe(8192);
    expect(model.capabilities.compat.supportsTools).toBe(true);
    expect(model.capabilities.compat.supportsReasoningEffort).toBe(false);
    expect(model.capabilities.inputModalities.has("image")).toBe(false);
    // pricing: opencode no lo reporta en /models, así que el curado rellena (no hay override).
    expect(model.pricing?.promptPerToken).toBe(0.000001);
    expect(model.enrichment).toEqual({ capabilities: "mixed", pricing: "curated" });
  });

  it("el row sólo rellena los campos que TRAE; el resto cae al curado (mezcla por campo)", () => {
    const row = { id: "x-model", context_length: 200000 }; // sólo contexto
    const model = createOpencodeModel({ baseUrl: BASE_URL, modelId: "x-model", row, curated: CURATED });
    expect(model.capabilities.contextWindowTokens).toBe(200000); // del proveedor
    expect(model.capabilities.maxOutputTokens).toBe(2048); // del curado (row no lo trae)
    expect(model.capabilities.compat.supportsTools).toBe(false); // del curado
  });

  it("desconocido-y-no-curado queda honesto: sin precio (null) y defaults", () => {
    const model = createOpencodeModel({ baseUrl: BASE_URL, modelId: "modelo-de-pago-no-curado" });
    expect(model.pricing).toBeNull();
    expect(model.enrichment?.pricing).toBe("none");
    // Sin contexto del proveedor ni curado, cae al default honesto del adaptador.
    expect(model.capabilities.contextWindowTokens).toBe(128000);
  });

  it("P7: un modelo opencode curado con precio da estimación REAL; uno no curado -> 'no disponible'", () => {
    // Curado (tier gratuito real): precio presente y numérico -> el indicador puede estimar (0).
    const free = createOpencodeModel({ baseUrl: BASE_URL, modelId: "minimax-m3-free" });
    expect(free.pricing).not.toBeNull();
    expect(typeof free.pricing?.promptPerToken).toBe("number");
    expect(free.enrichment?.pricing).toBe("curated");

    // No curado: sin precio -> el indicador mostrará "no disponible".
    const paid = createOpencodeModel({ baseUrl: BASE_URL, modelId: "glm-5.2" });
    expect(paid.pricing).toBeNull();
  });

  it("el mapa real es pequeño y honesto (sólo entradas documentadas)", () => {
    // Todas las entradas del mapa real declaran precio (lo documentable hoy = tier gratuito).
    for (const entry of Object.values(OPENCODE_CURATED)) {
      expect(entry.pricing).toBeTruthy();
    }
  });
});
