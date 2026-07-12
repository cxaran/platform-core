import type { CanonicalMessage } from "../domain/message.js";
import type { ModelDescriptor, ProviderProtocol } from "../domain/model.js";
import type { ModelToolDefinition, ToolCallResult, ToolCallRequest } from "../domain/tool.js";
import type { TurnUsage } from "../domain/usage.js";
import type { GenerationOptions } from "../application/capabilities/capability-negotiator.js";

export interface ProviderCredentialLease {
  leaseId: string;
  secret: string;
  expiresAt: Date;
  // Id de cuenta ChatGPT (solo credenciales OAuth/Codex). El adaptador OpenAI lo manda como
  // header ``chatgpt-account-id`` en el flavor codex_responses. Ausente para API keys.
  accountId?: string;
}

export interface ProviderTurnInput {
  turnId: string;
  model: ModelDescriptor;
  credential: ProviderCredentialLease;
  messages: CanonicalMessage[];
  tools: ModelToolDefinition[];
  options: GenerationOptions;
  signal: AbortSignal;
}

export interface ProviderResumeInput {
  turnId: string;
  model: ModelDescriptor;
  credential: ProviderCredentialLease;
  toolResults: ToolCallResult[];
  continuationState: unknown | null;
  signal: AbortSignal;
}

export type ProviderEvent =
  | { type: "text.delta"; delta: string }
  | { type: "tool_call.ready"; call: ToolCallRequest; continuationState?: unknown }
  | { type: "reasoning.summary"; summary: string }
  // ``truncated``: la respuesta quedó INCOMPLETA (el proveedor cortó por límite de longitud o el
  // stream terminó a media respuesta sin señal de fin). El cliente lo marca para que el usuario
  // sepa que el mensaje no está completo y pueda pedir continuar. Ausente/false = respuesta íntegra.
  | { type: "completed"; usage: TurnUsage; truncated?: boolean };

export interface ProviderAdapter {
  readonly protocol: ProviderProtocol;
  discoverModels(credential: ProviderCredentialLease): Promise<ModelDescriptor[]>;
  startTurn(input: ProviderTurnInput): AsyncIterable<ProviderEvent>;
  resumeTurn(input: ProviderResumeInput): AsyncIterable<ProviderEvent>;
}
