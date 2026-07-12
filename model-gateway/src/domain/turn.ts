import type { ModelDescriptor, ModelId, ProviderId } from "./model.js";
import type { ToolCallRequest } from "./tool.js";
import type { TurnUsage } from "./usage.js";

export type TurnStatus =
  | "created"
  | "authorizing"
  | "running"
  | "waiting_for_tool"
  | "resuming"
  | "completed"
  | "cancelled"
  | "failed"
  | "expired";

export interface ModelTurn {
  id: string;
  browserSessionId: string;
  profileId: string;
  providerId: ProviderId;
  modelId: ModelId;
  // Descriptor del modelo resuelto al crear el turn (discovery real del proveedor o
  // catálogo curado). Se guarda para que el resume use EXACTAMENTE el mismo modelo y sus
  // capacidades, sin depender de que siga en el catálogo curado.
  model: ModelDescriptor;
  status: TurnStatus;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  pendingToolCalls: Map<string, ToolCallRequest>;
  providerContinuationState: unknown | null;
  usage: TurnUsage;
}
