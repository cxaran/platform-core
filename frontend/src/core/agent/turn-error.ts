import type { GatewayProtocol } from "./protocol";

/**
 * Mapeo del error de un turno fallido a un mensaje para el usuario (en español). Por defecto
 * conserva el mensaje del gateway tal cual (no se traga ningún error); sólo un caso muy
 * concreto recibe un texto amistoso: opencode Zen devolviendo 401 en inferencia.
 *
 * Diagnóstico (MP-CTRL-0077): con opencode Zen la MISMA clave lista modelos (discovery 200)
 * pero la inferencia responde 401 -> la cuenta/plan NO tiene acceso a inferencia en Zen. No es
 * un bug de forma de la petición. Dentro de un turno, si llegamos a la llamada de inferencia es
 * porque el discovery ya funcionó (el modelo se resolvió), así que ``providerStatus === 401`` +
 * protocolo ``opencode_zen`` identifica exactamente este caso. El gateway sigue siendo neutral:
 * sólo expone ``providerStatus``; la decisión de UX (del negocio) vive aquí, en el frontend.
 */

export interface SurfacedTurnError {
  code: string;
  message: string;
  details?: unknown;
}

export const OPENCODE_ZEN_INFERENCE_401_MESSAGE =
  "Tu clave de OpenCode no tiene acceso a inferencia en Zen (sí puede listar modelos). " +
  "Verifica tu plan de OpenCode o usa OpenCode Go.";

const GENERIC_PREFIX = "No se pudo completar el turno: ";

/** ``providerStatus`` adjuntado por el gateway en ``details``, o ``null`` si no viene. */
function providerStatusOf(details: unknown): number | null {
  if (details && typeof details === "object" && "providerStatus" in details) {
    const value = (details as { providerStatus?: unknown }).providerStatus;
    return typeof value === "number" ? value : null;
  }
  return null;
}

/**
 * Texto a mostrar para un turno fallido. Devuelve el mensaje amistoso SÓLO para el caso
 * opencode-Zen-401-tras-discovery; cualquier otro error mantiene su mensaje original (con el
 * prefijo genérico), sin tragarse información.
 */
export function turnFailureMessage(
  error: SurfacedTurnError | null | undefined,
  protocol?: GatewayProtocol | null,
): string {
  if (!error) {
    return `${GENERIC_PREFIX}error`;
  }
  if (protocol === "opencode_zen" && providerStatusOf(error.details) === 401) {
    return OPENCODE_ZEN_INFERENCE_401_MESSAGE;
  }
  return `${GENERIC_PREFIX}${error.message || error.code || "error"}`;
}
