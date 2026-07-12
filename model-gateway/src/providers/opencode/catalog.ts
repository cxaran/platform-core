import type { ModelPricing } from "../../domain/model.js";

/**
 * Mapa CURADO de capacidades/precios de modelos opencode (Zen/Go), keyed por el id EXACTO que
 * ``/models`` devuelve. opencode entrega filas mínimas SIN metadatos de capacidad ni precios, por
 * eso se curan aquí (patrón OpenClaw: el catálogo del proveedor es pobre y se complementa).
 *
 * HONESTIDAD (innegociable): sólo se curan valores DOCUMENTABLES; lo que no se conoce de forma
 * fiable queda ``null`` (o ausente) y JAMÁS se inventa. PRECEDENCIA: lo que el proveedor reporta
 * en discovery SIEMPRE gana; este mapa SÓLO rellena huecos (ver ``createOpencodeModel``).
 *
 * Por qué casi sólo hay tier gratuito: a la fecha de esta curación no se dispone de una tarifa por
 * token PÚBLICA y VIGENTE para los modelos de PAGO de opencode Zen/Go, así que NO se les asigna
 * precio (queda null -> el indicador de costo dirá "no disponible", que es lo honesto). Los modelos
 * del TIER GRATUITO sí son documentables: opencode los marca con sufijo ``-free`` y no cobran por
 * token, por lo que su precio es 0 (una estimación real y honesta, no inventada).
 */

export interface OpencodeCuratedEntry {
  contextWindowTokens?: number | null;
  maxOutputTokens?: number | null;
  supportsTools?: boolean;
  supportsReasoning?: boolean;
  vision?: boolean;
  pricing?: ModelPricing | null;
}

// Precio 0 del tier gratuito (USD por token). Fuente: catálogo de opencode Zen, modelos con
// sufijo "-free" (sin cobro por token). Observado: jun-2026.
const FREE_TIER_PRICING: ModelPricing = {
  currency: "USD",
  promptPerToken: 0,
  completionPerToken: 0,
  cacheReadPerToken: 0,
  cacheWritePerToken: 0,
};

/**
 * Entradas curadas por id EXACTO. Pequeño y honesto: hoy sólo el tier gratuito (precio 0
 * documentable). Para añadir un modelo de pago, incluir su tarifa por token con su FUENTE/FECHA en
 * un comentario; si no se puede citar, dejar ``pricing`` en null. El contexto/visión siguen
 * resolviéndose desde el proveedor (gana) o ``opencodeSupportsVision`` donde aplique.
 */
export const OPENCODE_CURATED: Readonly<Record<string, OpencodeCuratedEntry>> = {
  // Tier gratuito de opencode Zen (sufijo -free): sin cobro por token -> precio 0.
  // Fuente: catálogo opencode Zen (modelos -free), jun-2026.
  "deepseek-v4-flash-free": { pricing: FREE_TIER_PRICING },
  "mimo-v2.5-free": { pricing: FREE_TIER_PRICING },
  "minimax-m3-free": { pricing: FREE_TIER_PRICING },
  "nemotron-3-ultra-free": { pricing: FREE_TIER_PRICING },
  "north-mini-code-free": { pricing: FREE_TIER_PRICING },
};

/** Entrada curada de un modelo opencode por su id exacto, o ``undefined`` si no está curado. */
export function opencodeCuratedFor(modelId: string): OpencodeCuratedEntry | undefined {
  return OPENCODE_CURATED[modelId];
}
