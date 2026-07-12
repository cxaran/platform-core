import { createId } from "../../kernel/ids.js";
import { GatewayError } from "../../kernel/errors.js";
import { emptyTurnUsage } from "../../domain/usage.js";
import { assertTurnTransition, isTerminalStatus } from "../../application/turns/turn-state-machine.js";
import type { ModelTurn, TurnStatus } from "../../domain/turn.js";
import type { ToolCallRequest, ToolCallResult } from "../../domain/tool.js";
import type { CreateTurnInput, TurnStorePort } from "../../ports/turn-store.port.js";

export class InMemoryTurnStore implements TurnStorePort {
  private readonly turns = new Map<string, ModelTurn>();

  async create(input: CreateTurnInput): Promise<ModelTurn> {
    const now = new Date();
    const turn: ModelTurn = {
      id: createId("turn"),
      browserSessionId: input.browserSessionId,
      profileId: input.authorization.profileId,
      providerId: input.authorization.providerId,
      modelId: input.authorization.modelId,
      model: input.model,
      status: "created",
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + input.authorization.limits.maxTurnDurationSeconds * 1000),
      pendingToolCalls: new Map(),
      providerContinuationState: null,
      usage: emptyTurnUsage()
    };

    this.turns.set(turn.id, turn);
    return turn;
  }

  async get(turnId: string): Promise<ModelTurn | null> {
    return this.turns.get(turnId) ?? null;
  }

  async transition(turnId: string, status: TurnStatus): Promise<ModelTurn> {
    const turn = this.mustGet(turnId);
    assertTurnTransition(turn.status, status);
    turn.status = status;
    turn.updatedAt = new Date();
    return turn;
  }

  async addPendingToolCall(turnId: string, call: ToolCallRequest): Promise<ModelTurn> {
    const turn = this.mustGet(turnId);
    if (turn.pendingToolCalls.has(call.callId)) {
      throw new GatewayError("DUPLICATE_TOOL_CALL", "Tool call is already pending", { callId: call.callId });
    }

    turn.pendingToolCalls.set(call.callId, call);
    turn.updatedAt = new Date();
    return turn;
  }

  async consumeToolResult(turnId: string, result: ToolCallResult): Promise<{ turn: ModelTurn; call: ToolCallRequest }> {
    const turn = this.mustGet(turnId);
    const call = turn.pendingToolCalls.get(result.callId);
    if (!call) {
      throw new GatewayError("UNKNOWN_TOOL_CALL", "Tool result does not match a pending tool call", {
        turnId,
        callId: result.callId
      });
    }

    turn.pendingToolCalls.delete(result.callId);
    turn.updatedAt = new Date();
    return { turn, call };
  }

  async setContinuationState(turnId: string, continuationState: unknown | null): Promise<ModelTurn> {
    const turn = this.mustGet(turnId);
    turn.providerContinuationState = continuationState;
    turn.updatedAt = new Date();
    return turn;
  }

  async setUsage(turnId: string, usage: ModelTurn["usage"]): Promise<ModelTurn> {
    const turn = this.mustGet(turnId);
    turn.usage = usage;
    turn.updatedAt = new Date();
    return turn;
  }

  async cancel(turnId: string): Promise<ModelTurn> {
    const turn = this.mustGet(turnId);
    assertTurnTransition(turn.status, "cancelled");
    turn.status = "cancelled";
    turn.pendingToolCalls.clear();
    turn.providerContinuationState = null;
    turn.updatedAt = new Date();
    return turn;
  }

  async cancelByBrowserSession(browserSessionId: string): Promise<ModelTurn[]> {
    const cancelled: ModelTurn[] = [];

    for (const turn of this.turns.values()) {
      if (turn.browserSessionId === browserSessionId && !isTerminalStatus(turn.status)) {
        assertTurnTransition(turn.status, "cancelled");
        turn.status = "cancelled";
        turn.pendingToolCalls.clear();
        turn.providerContinuationState = null;
        turn.updatedAt = new Date();
        cancelled.push(turn);
      }
    }

    return cancelled;
  }

  private mustGet(turnId: string): ModelTurn {
    const turn = this.turns.get(turnId);
    if (!turn) {
      throw new GatewayError("TURN_NOT_FOUND", "Turn was not found", { turnId });
    }

    return turn;
  }
}
