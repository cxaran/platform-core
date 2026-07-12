import { GatewayError, toGatewayError } from "../../kernel/errors.js";
import { isTerminalStatus } from "./turn-state-machine.js";
import type { BrowserSession } from "../../domain/gateway-session.js";
import type { TurnStorePort } from "../../ports/turn-store.port.js";
import type { TelemetryPort } from "../../ports/telemetry.port.js";
import type { TurnEventSink } from "./start-turn.js";

export interface CancelTurnDependencies {
  turnStore: TurnStorePort;
  telemetry: TelemetryPort;
}

/**
 * Verbo de control agent.cancel_turn (B6): cancela un turn en vuelo de la sesión actual.
 * Respeta la máquina de estados (transición -> cancelled vía el turn-store), limpia las
 * pending tool calls y emite turn.cancelled. Devuelve los ids cancelados.
 *
 * Si se pasa un turnId, cancela ese (validando que pertenezca a la sesión). Si no, cancela
 * los turns activos de la sesión; si no hay ninguno, falla con NO_ACTIVE_TURN.
 */
export class CancelTurn {
  constructor(private readonly dependencies: CancelTurnDependencies) {}

  async execute(
    browserSession: BrowserSession,
    input: { turnId?: string },
    sink: TurnEventSink
  ): Promise<string[]> {
    try {
      if (input.turnId) {
        const turn = await this.dependencies.turnStore.get(input.turnId);
        if (!turn || turn.browserSessionId !== browserSession.id) {
          throw new GatewayError("TURN_NOT_FOUND", "Turn was not found for this session", {
            turnId: input.turnId
          });
        }
        if (isTerminalStatus(turn.status)) {
          throw new GatewayError("TURN_NOT_CANCELLABLE", "Turn is already in a terminal state", {
            turnId: turn.id,
            status: turn.status
          });
        }

        await this.dependencies.turnStore.cancel(turn.id);
        await sink.emit({ type: "turn.cancelled", turn_id: turn.id });
        return [turn.id];
      }

      const cancelled = await this.dependencies.turnStore.cancelByBrowserSession(browserSession.id);
      if (cancelled.length === 0) {
        throw new GatewayError("NO_ACTIVE_TURN", "There is no active turn to cancel for this session");
      }

      for (const turn of cancelled) {
        await sink.emit({ type: "turn.cancelled", turn_id: turn.id });
      }
      return cancelled.map((turn) => turn.id);
    } catch (error) {
      const gatewayError = toGatewayError(error);
      this.dependencies.telemetry.error("turn cancel failed", {
        code: gatewayError.code,
        turnId: input.turnId ?? null
      });
      throw gatewayError;
    }
  }
}
