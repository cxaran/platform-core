import type { CanonicalMessage } from "../../domain/message.js";
import type { ModelToolDefinition } from "../../domain/tool.js";
import type { GenerationOptions } from "./capability-negotiator.js";

export interface StartTurnRequest {
  requestId: string;
  profileId: string;
  messages: CanonicalMessage[];
  tools: ModelToolDefinition[];
  generation: GenerationOptions;
}

export function estimateToolSchemaTokens(tools: readonly ModelToolDefinition[]): number {
  return Math.ceil(JSON.stringify(tools).length / 4);
}

export function estimateSystemTokens(messages: readonly CanonicalMessage[]): number {
  return Math.ceil(
    messages
      .filter((message) => message.role === "system")
      .flatMap((message) => message.content)
      .reduce((total, part) => total + (part.type === "text" ? part.text.length : part.data.length), 0) / 4
  );
}
