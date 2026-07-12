/**
 * Máquina de estado PURA de reconexión del copiloto (MP-CTRL-0084). No toca el WebSocket: sólo
 * decide la fase de conexión y CUÁNTO esperar antes del próximo intento (backoff exponencial
 * acotado). El panel la maneja: traduce los cambios de estado del ``AgentClient`` en eventos,
 * programa los temporizadores y re-ejecuta el handshake completo (ticket → browser-session → WS).
 *
 * Invariantes de seguridad:
 * - La máquina NO conoce turnos ni intenciones: por construcción NUNCA puede reenviar una
 *   escritura ni un turno tras reconectar. Sólo restablece el canal.
 * - ``dispose`` (cierre intencional: el usuario navegó fuera) es TERMINAL: no se reconecta.
 */

export interface ReconnectConfig {
  /** Tope de intentos de reconexión antes de rendirse (ofrecer reintento manual). */
  maxAttempts: number;
  /** Espera del primer reintento (ms). */
  baseDelayMs: number;
  /** Tope por espera (ms): el backoff nunca supera este valor. */
  maxDelayMs: number;
  /** Factor exponencial entre intentos. */
  factor: number;
}

export const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 15000,
  factor: 2,
};

export type ReconnectPhase =
  | "idle" // aún no se intentó conectar
  | "connecting" // intentando (inicial o reintento en curso)
  | "connected" // canal vivo
  | "reconnecting" // caído; esperando el backoff antes del próximo intento
  | "failed" // se agotaron los intentos; reintento MANUAL disponible
  | "disposed"; // cierre intencional; terminal, no reconectar

export interface ReconnectState {
  phase: ReconnectPhase;
  /** Intentos de reconexión consumidos desde la última conexión exitosa. */
  attempts: number;
  /** Espera (ms) antes del próximo intento; sólo en ``reconnecting``, si no ``null``. */
  nextDelayMs: number | null;
}

export type ReconnectEvent =
  | { type: "connect_start" } // arranca el intento inicial
  | { type: "connected" } // handshake exitoso
  | { type: "dropped" } // cierre/error inesperado o intento fallido
  | { type: "retry" } // venció el backoff: intentar de nuevo (auto)
  | { type: "manual_retry" } // el usuario pulsó "Reconectar" tras agotar intentos
  | { type: "dispose" }; // cierre intencional (desmontaje/navegación)

export function initialReconnectState(): ReconnectState {
  return { phase: "idle", attempts: 0, nextDelayMs: null };
}

/**
 * Espera del backoff para el intento ``attempt`` (1-based: el 1er reintento espera ``baseDelayMs``).
 * Crece exponencialmente y se ACOTA a ``maxDelayMs``.
 */
export function backoffDelay(attempt: number, config: ReconnectConfig = DEFAULT_RECONNECT_CONFIG): number {
  const exponent = Math.max(0, attempt - 1);
  const raw = config.baseDelayMs * Math.pow(config.factor, exponent);
  return Math.min(config.maxDelayMs, raw);
}

/**
 * Reductor puro: estado + evento → nuevo estado. ``disposed`` es absorbente (ignora todo). Un
 * ``dropped`` incrementa los intentos y, si se alcanzó el tope, pasa a ``failed`` (sin más backoff);
 * si no, programa el siguiente con su espera. Una reconexión exitosa REINICIA el backoff.
 */
export function reduceReconnect(
  state: ReconnectState,
  event: ReconnectEvent,
  config: ReconnectConfig = DEFAULT_RECONNECT_CONFIG,
): ReconnectState {
  // ``connect_start`` arranca SIEMPRE un ciclo nuevo, incluso desde ``disposed``. Un remonte
  // legítimo del panel (p. ej. el doble montaje de React StrictMode en dev, o reabrir el chat)
  // reusa el mismo estado persistido por ref; si ``disposed`` lo absorbiera, el segundo montaje
  // nunca pasaría a ``connecting`` y el cliente jamás llamaría a connect() (canal "Inactivo"
  // permanente). Es seguro: ``connect_start`` solo restablece el canal, nunca reenvía un turno.
  if (event.type === "connect_start") {
    return { phase: "connecting", attempts: 0, nextDelayMs: null };
  }
  if (state.phase === "disposed") {
    return state;
  }
  switch (event.type) {
    case "dispose":
      return { phase: "disposed", attempts: 0, nextDelayMs: null };

    case "connected":
      // Éxito: reinicia el contador de intentos y el backoff.
      return { phase: "connected", attempts: 0, nextDelayMs: null };

    case "dropped": {
      const attempts = state.attempts + 1;
      if (attempts >= config.maxAttempts) {
        return { phase: "failed", attempts, nextDelayMs: null };
      }
      return { phase: "reconnecting", attempts, nextDelayMs: backoffDelay(attempts, config) };
    }

    case "retry":
      // Sólo desde la espera de reconexión: lanza el siguiente intento (conserva el contador).
      if (state.phase !== "reconnecting") {
        return state;
      }
      return { phase: "connecting", attempts: state.attempts, nextDelayMs: null };

    case "manual_retry":
      // Sólo tras agotar intentos: reinicia el backoff y vuelve a intentar.
      if (state.phase !== "failed") {
        return state;
      }
      return { phase: "connecting", attempts: 0, nextDelayMs: null };

    default:
      return state;
  }
}
