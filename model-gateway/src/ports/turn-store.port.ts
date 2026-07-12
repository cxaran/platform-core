import type { ModelDescriptor } from "../domain/model.js";
import type { ModelTurn, TurnStatus } from "../domain/turn.js";
import type { ToolCallRequest, ToolCallResult } from "../domain/tool.js";
import type { TurnAuthorization } from "./control-plane.port.js";

export interface CreateTurnInput {
  browserSessionId: string;
  authorization: TurnAuthorization;
  model: ModelDescriptor;
}

export interface TurnStorePort {
  create(input: CreateTurnInput): Promise<ModelTurn>;
  get(turnId: string): Promise<ModelTurn | null>;
  transition(turnId: string, status: TurnStatus): Promise<ModelTurn>;
  addPendingToolCall(turnId: string, call: ToolCallRequest): Promise<ModelTurn>;
  consumeToolResult(turnId: string, result: ToolCallResult): Promise<{ turn: ModelTurn; call: ToolCallRequest }>;
  setContinuationState(turnId: string, continuationState: unknown | null): Promise<ModelTurn>;
  setUsage(turnId: string, usage: ModelTurn["usage"]): Promise<ModelTurn>;
  // Cancela un turn concreto (B6: verbo agent.cancel_turn) limpiando sus pending tool calls.
  cancel(turnId: string): Promise<ModelTurn>;
  cancelByBrowserSession(browserSessionId: string): Promise<ModelTurn[]>;
}
