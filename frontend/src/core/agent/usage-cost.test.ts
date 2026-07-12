import test from "node:test";
import assert from "node:assert/strict";

import type { TurnUsage, WireModel, WireModelPricing } from "@/core/agent/protocol";

import {
  addUsage,
  computeCost,
  emptyUsage,
  formatCost,
  resolvePricing,
  totalTokens,
  usageFromWire,
  type ModelCostRate,
} from "./usage-cost.ts";

function wireUsage(partial: Partial<TurnUsage>): TurnUsage {
  return {
    input_tokens: null,
    output_tokens: null,
    cached_input_tokens: null,
    cache_write_tokens: null,
    ...partial,
  };
}

function wirePricing(partial: Partial<WireModelPricing>): WireModelPricing {
  return {
    currency: "USD",
    prompt_per_token: null,
    completion_per_token: null,
    cache_read_per_token: null,
    cache_write_per_token: null,
    ...partial,
  };
}

function model(partial: Partial<WireModel>): WireModel {
  return {
    id: "openrouter/anthropic/claude-3.7-sonnet",
    label: "Claude 3.7 Sonnet",
    provider_id: "openrouter",
    provider_model_id: "anthropic/claude-3.7-sonnet",
    protocol: "openai_chat_completions",
    source: "discovered",
    deprecated_at: null,
    pricing: null,
    capabilities: {} as WireModel["capabilities"],
    ...partial,
  };
}

// --- acumulación de uso (incluye split de caché read/write) ---

test("usageFromWire convierte null a 0 y conserva conteos", () => {
  assert.deepEqual(usageFromWire(wireUsage({ input_tokens: 10, output_tokens: 4 })), {
    inputTokens: 10,
    outputTokens: 4,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
  });
  assert.deepEqual(usageFromWire(null), emptyUsage());
});

test("addUsage acumula por sesión incluyendo lectura y escritura de caché", () => {
  const turn1 = usageFromWire(
    wireUsage({ input_tokens: 30, output_tokens: 9, cached_input_tokens: 12, cache_write_tokens: 7 }),
  );
  const turn2 = usageFromWire(
    wireUsage({ input_tokens: 20, output_tokens: 5, cached_input_tokens: 3, cache_write_tokens: 0 }),
  );
  const session = addUsage(addUsage(emptyUsage(), turn1), turn2);
  assert.deepEqual(session, {
    inputTokens: 50,
    outputTokens: 14,
    cachedInputTokens: 15,
    cacheWriteTokens: 7,
  });
  assert.equal(totalTokens(session), 86);
  // addUsage es puro: no muta los operandos.
  assert.equal(turn1.inputTokens, 30);
});

// --- resolución de precio: discovery > curado > desconocido ---

test("resolvePricing prefiere el precio descubierto por el gateway", () => {
  const m = model({ pricing: wirePricing({ prompt_per_token: 0.000003, completion_per_token: 0.000015 }) });
  const rate = resolvePricing(m, {});
  assert.equal(rate?.promptPerToken, 0.000003);
  assert.equal(rate?.completionPerToken, 0.000015);
  assert.equal(rate?.currency, "USD");
});

test("resolvePricing cae al mapa curado por id o provider_model_id", () => {
  const curated: Record<string, ModelCostRate> = {
    "anthropic/claude-3.7-sonnet": {
      currency: "USD",
      promptPerToken: 0.000003,
      completionPerToken: 0.000015,
      cacheReadPerToken: null,
      cacheWritePerToken: null,
    },
  };
  const m = model({ pricing: null });
  const rate = resolvePricing(m, curated);
  assert.equal(rate?.promptPerToken, 0.000003);
});

test("resolvePricing devuelve null cuando no hay precio (desconocido honesto)", () => {
  assert.equal(resolvePricing(model({ pricing: null }), {}), null);
  assert.equal(resolvePricing(undefined, {}), null);
});

// --- cálculo de costo: conocido, parcial y desconocido ---

test("computeCost con precio conocido valora cada cubeta con su tarifa", () => {
  const usage = usageFromWire(
    wireUsage({ input_tokens: 1000, output_tokens: 500, cached_input_tokens: 200, cache_write_tokens: 100 }),
  );
  const rate: ModelCostRate = {
    currency: "USD",
    promptPerToken: 0.000003,
    completionPerToken: 0.000015,
    cacheReadPerToken: 0.0000003,
    cacheWritePerToken: 0.00000375,
  };
  const cost = computeCost(usage, rate);
  assert.ok(cost);
  assert.equal(cost.inputCost, 1000 * 0.000003);
  assert.equal(cost.outputCost, 500 * 0.000015);
  assert.equal(cost.cacheReadCost, 200 * 0.0000003);
  assert.equal(cost.cacheWriteCost, 100 * 0.00000375);
  assert.equal(
    cost.total,
    1000 * 0.000003 + 500 * 0.000015 + 200 * 0.0000003 + 100 * 0.00000375,
  );
});

test("computeCost sin tarifa de caché no agrega costo por caché (no inventa)", () => {
  const usage = usageFromWire(
    wireUsage({ input_tokens: 1000, output_tokens: 500, cached_input_tokens: 200, cache_write_tokens: 100 }),
  );
  const rate: ModelCostRate = {
    currency: "USD",
    promptPerToken: 0.000003,
    completionPerToken: 0.000015,
    cacheReadPerToken: null,
    cacheWritePerToken: null,
  };
  const cost = computeCost(usage, rate);
  assert.ok(cost);
  assert.equal(cost.cacheReadCost, 0);
  assert.equal(cost.cacheWriteCost, 0);
  assert.equal(cost.total, 1000 * 0.000003 + 500 * 0.000015);
});

test("computeCost devuelve null si no hay precio o falta tarifa base (no disponible)", () => {
  const usage = usageFromWire(wireUsage({ input_tokens: 1000, output_tokens: 500 }));
  assert.equal(computeCost(usage, null), null);
  // Falta el precio de salida -> desconocido, no se inventa.
  assert.equal(
    computeCost(usage, {
      currency: "USD",
      promptPerToken: 0.000003,
      completionPerToken: null,
      cacheReadPerToken: null,
      cacheWritePerToken: null,
    }),
    null,
  );
});

// --- formato y ausencia de secretos/PHI ---

test("formatCost usa precisión suficiente para costos sub-centavo", () => {
  const small = formatCost({
    currency: "USD",
    inputCost: 0.000123,
    outputCost: 0,
    cacheReadCost: 0,
    cacheWriteCost: 0,
    total: 0.000123,
  });
  assert.match(small, /USD 0\.000123/);
  const big = formatCost({
    currency: "USD",
    inputCost: 1.5,
    outputCost: 0,
    cacheReadCost: 0,
    cacheWriteCost: 0,
    total: 1.5,
  });
  assert.equal(big, "USD 1.50");
});

test("el uso normalizado solo contiene conteos numéricos (sin secretos ni PHI)", () => {
  const usage = usageFromWire(
    wireUsage({ input_tokens: 10, output_tokens: 2, cached_input_tokens: 1, cache_write_tokens: 0 }),
  );
  for (const value of Object.values(usage)) {
    assert.equal(typeof value, "number");
  }
  assert.deepEqual(Object.keys(usage).sort(), [
    "cacheWriteTokens",
    "cachedInputTokens",
    "inputTokens",
    "outputTokens",
  ]);
});
