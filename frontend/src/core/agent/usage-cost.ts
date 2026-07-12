import type { TurnUsage, WireModel, WireModelPricing } from "@/core/agent/protocol";

/**
 * Contabilidad de USO y COSTO por usuario (P7, paridad OpenClaw, provider-neutral). Igual que el
 * resto de la inteligencia del copiloto, vive en el NAVEGADOR del usuario autenticado: la sesión
 * del panel ES la del usuario, así que el acumulado por sesión es intrínsecamente por-usuario (no
 * hay libro mayor en servidor en P7; el gateway ya reporta el uso por turno sin secretos ni datos sensibles).
 *
 * Dos responsabilidades:
 *  (a) ACUMULAR el uso por turno y por sesión, con el split de caché (lectura/escritura) cuando
 *      el proveedor lo reporta (p. ej. Anthropic informa creación de caché). El gateway entrega
 *      conteos normalizados; aquí solo se suman.
 *  (b) ESTIMAR el costo a partir del precio por token del modelo. El precio viene del DESCUBRIMIENTO
 *      del gateway (hoy solo OpenRouter publica precios en su /models) o, si no, de un mapa curado
 *      explícito. Si no hay precio, el costo es DESCONOCIDO (null) y la UI muestra "no disponible":
 *      JAMÁS se inventa una cifra.
 *
 * Honestidad del cálculo: cada cubeta reportada (entrada, salida, lectura de caché, escritura de
 * caché) se valora con SU propia tarifa. Es una ESTIMACIÓN; la factura real del proveedor puede
 * diferir (p. ej. por cómo cada proveedor contabiliza los tokens cacheados). Solo se computa si el
 * precio de entrada y salida se conoce; las tarifas de caché ausentes no agregan costo.
 *
 * Sin secretos ni datos sensibles: este módulo solo maneja CONTEOS e identificadores de modelo.
 */

/** Uso normalizado y acumulable (conteos no nulos; el null del cable se trata como 0). */
export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens de LECTURA de caché (cache hit). */
  cachedInputTokens: number;
  /** Tokens de ESCRITURA de caché (solo algunos proveedores lo reportan). */
  cacheWriteTokens: number;
}

/** Tarifa por token de un modelo (misma forma que el pricing del cable, ya numérica). */
export interface ModelCostRate {
  currency: string;
  promptPerToken: number | null;
  completionPerToken: number | null;
  cacheReadPerToken: number | null;
  cacheWritePerToken: number | null;
}

/** Desglose del costo estimado de un uso dado (en la moneda de la tarifa). */
export interface CostBreakdown {
  currency: string;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  total: number;
}

/**
 * Mapa de precios CURADO para proveedores que NO publican precios vía discovery. Vacío a
 * propósito: preferimos mostrar "no disponible" antes que arriesgar una cifra desactualizada.
 * Para habilitar una estimación, agrega aquí una entrada con el precio público vigente del
 * proveedor, indexada por el id del modelo (``provider/model``) o por su ``provider_model_id``.
 */
export const CURATED_PRICING: Readonly<Record<string, ModelCostRate>> = {};

export function emptyUsage(): NormalizedUsage {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0 };
}

/** Convierte el usage del cable (campos nullable) a la forma acumulable (null -> 0). */
export function usageFromWire(usage: TurnUsage | null | undefined): NormalizedUsage {
  if (!usage) {
    return emptyUsage();
  }
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cachedInputTokens: usage.cached_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_write_tokens ?? 0,
  };
}

/** Suma dos usos (acumulación por sesión). Puro: no muta los argumentos. */
export function addUsage(a: NormalizedUsage, b: NormalizedUsage): NormalizedUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/** Total de tokens del uso (suma de todas las cubetas), para el indicador. */
export function totalTokens(usage: NormalizedUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cachedInputTokens + usage.cacheWriteTokens;
}

function rateFromWire(pricing: WireModelPricing): ModelCostRate {
  return {
    currency: pricing.currency,
    promptPerToken: pricing.prompt_per_token,
    completionPerToken: pricing.completion_per_token,
    cacheReadPerToken: pricing.cache_read_per_token,
    cacheWritePerToken: pricing.cache_write_per_token,
  };
}

/**
 * Resuelve la tarifa de un modelo. Prioridad: precio DESCUBIERTO por el gateway (autoritativo y
 * fresco) > mapa curado (por id de modelo o provider_model_id) > null (desconocido honesto).
 */
export function resolvePricing(
  model: WireModel | undefined,
  curated: Readonly<Record<string, ModelCostRate>> = CURATED_PRICING,
): ModelCostRate | null {
  if (model?.pricing) {
    return rateFromWire(model.pricing);
  }
  if (model) {
    return curated[model.id] ?? curated[model.provider_model_id] ?? null;
  }
  return null;
}

/**
 * Costo estimado de un uso con una tarifa. Devuelve null (DESCONOCIDO) si no hay tarifa o si no se
 * conoce el precio de entrada y salida (las cubetas base): preferimos no informar a inventar. Las
 * tarifas de caché ausentes simplemente no suman costo.
 */
export function computeCost(
  usage: NormalizedUsage,
  pricing: ModelCostRate | null,
): CostBreakdown | null {
  if (!pricing) {
    return null;
  }
  if (pricing.promptPerToken === null || pricing.completionPerToken === null) {
    return null;
  }
  const inputCost = usage.inputTokens * pricing.promptPerToken;
  const outputCost = usage.outputTokens * pricing.completionPerToken;
  const cacheReadCost =
    pricing.cacheReadPerToken === null ? 0 : usage.cachedInputTokens * pricing.cacheReadPerToken;
  const cacheWriteCost =
    pricing.cacheWritePerToken === null ? 0 : usage.cacheWriteTokens * pricing.cacheWritePerToken;
  return {
    currency: pricing.currency,
    inputCost,
    outputCost,
    cacheReadCost,
    cacheWriteCost,
    total: inputCost + outputCost + cacheReadCost + cacheWriteCost,
  };
}

/** Formatea conteos de tokens para el indicador (es-MX). */
export function formatTokens(value: number): string {
  return value.toLocaleString("es");
}

/**
 * Formatea un costo en su moneda. Los costos de IA suelen ser fracciones de centavo; se muestran
 * con suficiente precisión (hasta 6 decimales) para no redondear a cero un costo real pequeño.
 */
export function formatCost(breakdown: CostBreakdown): string {
  const total = breakdown.total;
  const decimals = total > 0 && total < 0.01 ? 6 : total < 1 ? 4 : 2;
  return `${breakdown.currency} ${total.toFixed(decimals)}`;
}
