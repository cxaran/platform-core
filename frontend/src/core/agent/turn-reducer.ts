import type { ServerEvent, TurnUsage } from "./protocol";

export type TurnStatus =
  | "idle"
  | "running"
  | "waiting_for_tool"
  | "completed"
  | "cancelled"
  | "failed";

export interface TurnState {
  status: TurnStatus;
  turnId: string | null;
  // Texto del asistente acumulado desde delta+snapshot del gateway.
  assistantText: string;
  // Resumen de razonamiento ("pensamiento") acumulado de los eventos turn.reasoning.summary.
  // Lo emiten todos los proveedores con reasoning (Codex, Anthropic thinking, Gemini, etc.).
  reasoningText: string;
  usage: TurnUsage | null;
  // ``details`` conserva la metadata del error del proveedor (p. ej. ``providerStatus``)
  // que el gateway adjunta en ``turn.failed``; la usa el mapeo a mensaje amistoso.
  error: { code: string; message: string; details?: unknown } | null;
}

export function initialTurnState(): TurnState {
  return {
    status: "idle",
    turnId: null,
    assistantText: "",
    reasoningText: "",
    usage: null,
    error: null,
  };
}

/**
 * Falla LIMPIAMENTE un turno en vuelo cuando se cae la conexión con el copiloto: evita el spinner
 * colgado. Sólo afecta a un turno activo (``running``/``waiting_for_tool``); cualquier otro estado
 * (idle/completed/failed/cancelled) se devuelve intacto. No toca el registro ni reenvía nada: la
 * recuperación del canal NO recupera intenciones en vuelo (el usuario re-inicia).
 */
export function failInFlightTurn(state: TurnState, message: string): TurnState {
  if (state.status !== "running" && state.status !== "waiting_for_tool") {
    return state;
  }
  return { ...state, status: "failed", error: { code: "CONNECTION_LOST", message } };
}

export function reduceTurnEvent(state: TurnState, event: ServerEvent): TurnState {
  switch (event.type) {
    case "turn.started":
      return {
        ...initialTurnState(),
        status: "running",
        turnId: event.turn_id,
      };

    case "turn.text.delta":
      return {
        ...state,
        status: state.status === "idle" ? "running" : state.status,
        turnId: state.turnId ?? event.turn_id,
        assistantText:
          typeof event.snapshot === "string" ? event.snapshot : state.assistantText + event.delta,
      };

    case "turn.tool_call.ready":
      // El despacho de la tool ocurre en el panel directamente desde el EVENTO (handleToolCall);
      // el reducer sólo marca el estado (no acumula la lista de calls: nadie la leía).
      return {
        ...state,
        status: "waiting_for_tool",
        turnId: state.turnId ?? event.turn_id,
      };

    case "turn.reasoning.summary":
      return {
        ...state,
        status: state.status === "idle" ? "running" : state.status,
        turnId: state.turnId ?? event.turn_id,
        reasoningText: state.reasoningText + event.summary,
      };

    case "turn.completed":
      return { ...state, status: "completed", usage: event.usage };

    case "turn.cancelled":
      return { ...state, status: "cancelled" };

    case "turn.failed":
      return {
        ...state,
        status: "failed",
        error: { code: event.code, message: event.message, details: event.details },
      };

    default:
      // Los eventos de RPC (tool discovery, etc.) no alteran el estado del turn.
      return state;
  }
}
