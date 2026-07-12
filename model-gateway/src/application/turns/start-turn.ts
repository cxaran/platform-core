import { ContextBudgeter } from "../../domain/context-budget.js";
import { estimateMessageTokens } from "../../domain/message.js";
import { GatewayError, toGatewayError } from "../../kernel/errors.js";
import { negotiateCapabilities } from "../capabilities/capability-negotiator.js";
import { estimateSystemTokens, estimateToolSchemaTokens } from "../capabilities/request-normalizer.js";
import type { BrowserSession } from "../../domain/gateway-session.js";
import type { GatewaySettings } from "../../config/settings.js";
import type { ControlPlanePort, TurnAuthorization } from "../../ports/control-plane.port.js";
import type { ModelCatalogPort } from "../../ports/model-catalog.port.js";
import type { ModelDiscoveryService } from "../capabilities/model-discovery.js";
import type { ProviderRegistryPort } from "../../ports/provider-registry.port.js";
import type { RateLimiterPort } from "../../ports/rate-limiter.port.js";
import type { TurnStorePort } from "../../ports/turn-store.port.js";
import type { TelemetryPort } from "../../ports/telemetry.port.js";
import type { ProviderEvent, ProviderCredentialLease } from "../../ports/provider-adapter.port.js";
import type { StartTurnRequest } from "../capabilities/request-normalizer.js";
import type { TurnUsage } from "../../domain/usage.js";

export type TurnEvent =
  | { type: "turn.started"; turn_id: string }
  // B6 (patrón OpenClaw): además del delta incremental, snapshot = texto acumulado del
  // mensaje en este segmento de streaming, para que un cliente que reconecta resincronice.
  | { type: "turn.text.delta"; turn_id: string; delta: string; snapshot: string }
  | { type: "turn.reasoning.summary"; turn_id: string; summary: string }
  | { type: "turn.tool_call.ready"; turn_id: string; call_id: string; tool_name: string; arguments: unknown }
  | { type: "turn.completed"; turn_id: string; usage: { input_tokens: number | null; output_tokens: number | null; cached_input_tokens: number | null; cache_write_tokens: number | null }; truncated?: boolean }
  | { type: "turn.cancelled"; turn_id: string }
  | { type: "turn.failed"; turn_id?: string; code: string; message: string; details?: unknown };

export interface TurnEventSink {
  emit(event: TurnEvent): Promise<void>;
}

export interface StartTurnDependencies {
  controlPlane: ControlPlanePort;
  modelCatalog: ModelCatalogPort;
  // Resuelve el modelo seleccionado consultando el proveedor (capacidades reales), con
  // fallback al catálogo curado.
  modelDiscovery: ModelDiscoveryService;
  providerRegistry: ProviderRegistryPort;
  turnStore: TurnStorePort;
  limiter: RateLimiterPort;
  telemetry: TelemetryPort;
  settings: GatewaySettings;
}

export class StartTurn {
  private readonly contextBudgeter = new ContextBudgeter();

  constructor(private readonly dependencies: StartTurnDependencies) {}

  async execute(browserSession: BrowserSession, request: StartTurnRequest, sink: TurnEventSink): Promise<void> {
    let authorization: TurnAuthorization | null = null;
    let lease: ProviderCredentialLease | null = null;
    let turnId: string | null = null;

    try {
      if (request.tools.length > this.dependencies.settings.maxToolsPerTurn) {
        throw new GatewayError("REQUEST_LIMIT_EXCEEDED", "Too many tools were supplied for one turn", {
          maxToolsPerTurn: this.dependencies.settings.maxToolsPerTurn
        });
      }

      authorization = await this.dependencies.controlPlane.authorizeTurn({
        browserSessionId: browserSession.id,
        profileId: request.profileId
      });

      // Capacidades del modelo desde el proveedor (discovery real), no asumidas; cae al
      // catálogo curado si el proveedor no se puede consultar.
      const model = await this.dependencies.modelDiscovery.resolveForUser(
        authorization.userId,
        authorization.providerId,
        authorization.modelId
      );

      const hasImageContent = request.messages.some((message) =>
        message.content.some((part) => part.type === "image")
      );

      const negotiated = negotiateCapabilities({
        model,
        tools: request.tools,
        generation: request.generation,
        policy: authorization.allowedCapabilities,
        hasImageContent
      });

      const requestedMaxOutputTokens = Math.min(
        request.generation.maxOutputTokens,
        authorization.limits.maxOutputTokens ?? request.generation.maxOutputTokens
      );
      const budget = this.contextBudgeter.assess({
        model,
        requestedMaxOutputTokens,
        profileMaxInputTokens: authorization.limits.maxInputTokens,
        gatewayGlobalMaxContextTokens: this.dependencies.settings.globalMaxContextTokens,
        estimatedMessageTokens: estimateMessageTokens(request.messages),
        estimatedToolSchemaTokens: estimateToolSchemaTokens(request.tools),
        estimatedSystemTokens: estimateSystemTokens(request.messages),
        safetyReserveTokens: this.dependencies.settings.safetyReserveTokens
      });

      if (!budget.fits) {
        await sink.emit({
          type: "turn.failed",
          code: "CONTEXT_LIMIT_EXCEEDED",
          message: "Estimated input exceeds the selected model context budget",
          details: budget
        });
        return;
      }

      await this.dependencies.limiter.acquire({
        userId: authorization.userId,
        profileId: authorization.profileId
      });

      lease = await this.dependencies.controlPlane.leaseCredential({ authorization, purpose: "model_turn" });
      const turn = await this.dependencies.turnStore.create({
        browserSessionId: browserSession.id,
        authorization,
        model
      });
      turnId = turn.id;

      await this.dependencies.turnStore.transition(turn.id, "authorizing");
      await this.dependencies.turnStore.transition(turn.id, "running");
      await sink.emit({ type: "turn.started", turn_id: turn.id });

      const adapter = this.dependencies.providerRegistry.get(model.route.protocol);
      const abortController = new AbortController();
      const accumulator = { text: "" };

      for await (const event of adapter.startTurn({
        turnId: turn.id,
        model,
        credential: lease,
        messages: request.messages,
        tools: [...negotiated.tools],
        options: negotiated.generation,
        signal: abortController.signal
      })) {
        await this.handleProviderEvent(turn.id, event, sink, accumulator, authorization);
      }
    } catch (error) {
      const gatewayError = toGatewayError(error);
      this.dependencies.telemetry.error("turn failed", { code: gatewayError.code, turnId });

      if (turnId) {
        const turn = await this.dependencies.turnStore.get(turnId);
        if (turn && turn.status !== "failed" && turn.status !== "completed" && turn.status !== "cancelled") {
          await this.dependencies.turnStore.transition(turnId, "failed");
        }
      }

      await sink.emit({
        type: "turn.failed",
        code: gatewayError.code,
        message: gatewayError.message,
        details: gatewayError.details
      });
    } finally {
      if (lease) {
        await this.dependencies.controlPlane.releaseCredentialLease(lease.leaseId);
      }

      if (authorization) {
        await this.dependencies.limiter.release({
          userId: authorization.userId,
          profileId: authorization.profileId
        });
      }
    }
  }

  private async handleProviderEvent(
    turnId: string,
    event: ProviderEvent,
    sink: TurnEventSink,
    accumulator: { text: string },
    authorization: TurnAuthorization
  ): Promise<void> {
    if (event.type === "text.delta") {
      accumulator.text += event.delta;
      await sink.emit({ type: "turn.text.delta", turn_id: turnId, delta: event.delta, snapshot: accumulator.text });
      return;
    }

    if (event.type === "reasoning.summary") {
      await sink.emit({ type: "turn.reasoning.summary", turn_id: turnId, summary: event.summary });
      return;
    }

    if (event.type === "tool_call.ready") {
      await this.dependencies.turnStore.addPendingToolCall(turnId, event.call);
      await this.dependencies.turnStore.setContinuationState(turnId, event.continuationState ?? null);
      await this.dependencies.turnStore.transition(turnId, "waiting_for_tool");
      this.scheduleToolResultTimeout(turnId, sink);
      await sink.emit({
        type: "turn.tool_call.ready",
        turn_id: turnId,
        call_id: event.call.callId,
        tool_name: event.call.name,
        arguments: event.call.arguments
      });
      return;
    }

    await this.completeTurn(turnId, event.usage, sink, authorization, event.truncated ?? false);
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

  private async completeTurn(
    turnId: string,
    usage: TurnUsage,
    sink: TurnEventSink,
    authorization: TurnAuthorization,
    truncated = false
  ): Promise<void> {
    await this.dependencies.turnStore.setUsage(turnId, usage);
    await this.dependencies.turnStore.transition(turnId, "completed");

    // Reporte de uso al control-plane, NO FATAL: un fallo de reporte no debe romper un turno
    // que ya completó (el usage queda igualmente en el turn store).
    try {
      await this.dependencies.controlPlane.reportTurnUsage({ turnId, authorization, usage });
    } catch (error) {
      this.dependencies.telemetry.warn("turn usage report failed", {
        turnId,
        code: toGatewayError(error).code
      });
    }

    await sink.emit({
      type: "turn.completed",
      turn_id: turnId,
      usage: {
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cached_input_tokens: usage.cachedInputTokens,
        cache_write_tokens: usage.cacheWriteTokens
      },
      truncated
    });
  }
}
