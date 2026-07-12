import type { ProviderProtocol, ReasoningEffort } from "./model.js";

/**
 * Normalización de reasoning / thinking-effort entre proveedores (P5, paridad OpenClaw:
 * niveles off..max + mapeo por proveedor + precedencia + visibilidad), provider-neutral.
 *
 * La ESCALA NORMALIZADA vive en el dominio; cada adaptador la traduce a su parámetro nativo.
 * Gating HONESTO: el control solo se honra cuando la capacidad negociada del modelo
 * (``compat.supportsReasoningEffort``) dice que lo soporta; si no, se OMITE por completo (no
 * se envía ningún parámetro de razonamiento al proveedor).
 */

/** Escala normalizada de esfuerzo de razonamiento (de menor a mayor). */
export const NORMALIZED_REASONING_EFFORTS = ["off", "low", "medium", "high", "max"] as const;
export type NormalizedReasoningEffort = (typeof NORMALIZED_REASONING_EFFORTS)[number];

export function isNormalizedReasoningEffort(value: unknown): value is NormalizedReasoningEffort {
  return (
    typeof value === "string" &&
    (NORMALIZED_REASONING_EFFORTS as readonly string[]).includes(value)
  );
}

/**
 * Decide el nivel a HONRAR: ``null`` (omitir) si no hay nivel, si es ``off`` o si el modelo/
 * política no soportan el control. En cualquier otro caso, el nivel normalizado.
 */
export function honorReasoningEffort(
  level: NormalizedReasoningEffort | undefined,
  supported: boolean
): NormalizedReasoningEffort | null {
  if (!level || level === "off" || !supported) {
    return null;
  }
  return level;
}

/**
 * Mapea el nivel normalizado al parámetro NATIVO del proveedor. ``null`` = omitir (off o
 * proveedor sin soporte). OpenAI/Codex y opencode (OpenAI-compatible) usan la escala
 * ``low|medium|high``; ``max`` se mapea al máximo nativo documentado (``high``). Proveedores
 * sin razonamiento por effort devuelven ``null`` (no se inventa un parámetro).
 */
export function nativeReasoningEffort(
  protocol: ProviderProtocol,
  level: NormalizedReasoningEffort | null | undefined
): ReasoningEffort | null {
  if (!level || level === "off") {
    return null;
  }
  switch (protocol) {
    case "openai":
    case "openai_codex":
    case "opencode_zen":
    case "opencode_go":
    case "openai_chat_completions":
    // Runtime local OpenAI-compatible (Ollama/vLLM): si un modelo local soporta reasoning,
    // usa el parámetro estilo OpenAI (reasoning_effort). Por defecto el local no lo reporta.
    case "ollama_chat":
      return level === "max" ? "high" : level;
    default:
      return null;
  }
}
