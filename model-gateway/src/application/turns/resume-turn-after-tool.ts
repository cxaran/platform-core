import { GatewayError, toGatewayError } from "../../kernel/errors.js";
import { isTerminalStatus } from "./turn-state-machine.js";
import type { ModelCatalogPort } from "../../ports/model-catalog.port.js";
import type { ProviderCredentialLease } from "../../ports/provider-adapter.port.js";
import type { ProviderRegistryPort } from "../../ports/provider-registry.port.js";
import type { TurnStorePort } from "../../ports/turn-store.port.js";
import type { ControlPlanePort } from "../../ports/control-plane.port.js";
import type { TelemetryPort } from "../../ports/telemetry.port.js";
import type { ToolCallResult } from "../../domain/tool.js";
import type { TurnEventSink } from "./start-turn.js";
import type { GatewaySettings } from "../../config/settings.js";

export interface ResumeTurnDependencies {
  turnStore: TurnStorePort;
  modelCatalog: ModelCatalogPort;
  providerRegistry: ProviderRegistryPort;
  controlPlane: ControlPlanePort;
  telemetry: TelemetryPort;
  settings: GatewaySettings;
}

export class ResumeTurnAfterTool {
  constructor(private readonly dependencies: ResumeTurnDependencies) {}

  async execute(turnId: string, result: ToolCallResult, sink: TurnEventSink): Promise<void> {
    let lease: ProviderCredentialLease | null = null;

    try {
      const current = await this.dependencies.turnStore.get(turnId);
      if (!current) {
        throw new GatewayError("TURN_NOT_FOUND", "Turn was not found", { turnId });
      }

      if (current.status !== "waiting_for_tool") {
        // Resultado TARDÍO o DUPLICADO: llegó cuando el turno ya terminó (expiró, se canceló, falló
        // o completó) o ya avanzó. No es un error del usuario: se DESCARTA en silencio (sin emitir un
        // turn.failed que ensucie el hilo con un doble fallo). Sólo se registra a nivel debug.
        if (isTerminalStatus(current.status)) {
          this.dependencies.telemetry.info("late tool result discarded", {
            turnId,
            status: current.status
          });
          return;
        }
        throw new GatewayError("TURN_NOT_WAITING_FOR_TOOL", "Turn is not waiting for a tool result", {
          turnId,
          status: current.status
        });
      }

      const { turn } = await this.dependencies.turnStore.consumeToolResult(turnId, result);
      await this.dependencies.turnStore.transition(turn.id, "resuming");

      // El modelo (con sus capacidades reales) se fijó al crear el turn; se reutiliza para
      // que el resume no dependa de que el modelo siga en el catálogo curado.
      const model = turn.model;
      const authorization = await this.dependencies.controlPlane.authorizeTurn({
        browserSessionId: turn.browserSessionId,
        profileId: turn.profileId
      });
      lease = await this.dependencies.controlPlane.leaseCredential({ authorization, purpose: "model_turn" });
      const adapter = this.dependencies.providerRegistry.get(model.route.protocol);
      const abortController = new AbortController();

      await this.dependencies.turnStore.transition(turn.id, "running");
      const accumulator = { text: "" };
      for await (const event of adapter.resumeTurn({
        turnId: turn.id,
        model,
        credential: lease,
        toolResults: [result],
        continuationState: turn.providerContinuationState,
        signal: abortController.signal
      })) {
        if (event.type === "text.delta") {
          accumulator.text += event.delta;
          await sink.emit({ type: "turn.text.delta", turn_id: turn.id, delta: event.delta, snapshot: accumulator.text });
        } else if (event.type === "reasoning.summary") {
          await sink.emit({ type: "turn.reasoning.summary", turn_id: turn.id, summary: event.summary });
        } else if (event.type === "tool_call.ready") {
          await this.dependencies.turnStore.addPendingToolCall(turn.id, event.call);
          await this.dependencies.turnStore.setContinuationState(turn.id, event.continuationState ?? null);
          await this.dependencies.turnStore.transition(turn.id, "waiting_for_tool");
          this.scheduleToolResultTimeout(turn.id, sink);
          await sink.emit({
            type: "turn.tool_call.ready",
            turn_id: turn.id,
            call_id: event.call.callId,
            tool_name: event.call.name,
            arguments: event.call.arguments
          });
        } else {
          await this.dependencies.turnStore.setUsage(turn.id, event.usage);
          await this.dependencies.turnStore.transition(turn.id, "completed");
          // Reporte de uso al control-plane, NO FATAL: un fallo de reporte no debe romper un
          // turno que ya completó (el usage queda igualmente en el turn store).
          try {
            await this.dependencies.controlPlane.reportTurnUsage({
              turnId: turn.id,
              authorization,
              usage: event.usage
            });
          } catch (reportError) {
            this.dependencies.telemetry.warn("turn usage report failed", {
              turnId: turn.id,
              code: toGatewayError(reportError).code
            });
          }
          await sink.emit({
            type: "turn.completed",
            turn_id: turn.id,
            usage: {
              input_tokens: event.usage.inputTokens,
              output_tokens: event.usage.outputTokens,
              cached_input_tokens: event.usage.cachedInputTokens,
              cache_write_tokens: event.usage.cacheWriteTokens
            },
            truncated: event.truncated ?? false
          });
        }
      }
    } catch (error) {
      const gatewayError = toGatewayError(error);
      this.dependencies.telemetry.error("turn resume failed", { code: gatewayError.code, turnId });
      await sink.emit({
        type: "turn.failed",
        turn_id: turnId,
        code: gatewayError.code,
        message: gatewayError.message,
        details: gatewayError.details
      });
    } finally {
      if (lease) {
        await this.dependencies.controlPlane.releaseCredentialLease(lease.leaseId);
      }
    }
  }

  private scheduleToolResultTimeout(turnId: string, sink: TurnEventSink): void {
    // 0 (o menos) = timeout desactivado: la espera de una aprobación humana P1 es ilimitada y no
    // debe expirar el turno. La fuga de turnos abandonados la cubre el cierre del socket.
    if (this.dependencies.settings.toolResultTimeoutMs <= 0) {
      return;
    }
    const timeout = setTimeout(() => {
      void (async () => {
        const turn = await this.dependencies.turnStore.get(turnId);
        if (!turn || turn.status !== "waiting_for_tool") {
          return;
        }

        await this.dependencies.turnStore.transition(turnId, "expired");
        await sink.emit({
          type: "turn.failed",
          turn_id: turnId,
          code: "TOOL_RESULT_TIMEOUT",
          message: "Timed out waiting for tool result"
        });
      })();
    }, this.dependencies.settings.toolResultTimeoutMs);

    timeout.unref();
  }
}
