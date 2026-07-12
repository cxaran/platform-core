import { Value } from "@sinclair/typebox/value";
import {
  AgentCancelTurnMessageSchema,
  ModelsListMessageSchema,
  ProviderStatusMessageSchema,
  TurnStartMessageSchema,
  TurnToolResultMessageSchema
} from "./protocol.schema.js";
import type { TSchema } from "@sinclair/typebox";
import type { CatalogView } from "../../ports/model-catalog.port.js";
import type { ClientMessage } from "./protocol.schema.js";
import type { StartTurnRequest } from "../../application/capabilities/request-normalizer.js";
import type { ToolCallResult } from "../../domain/tool.js";

function schemaErrorText(schema: TSchema, value: unknown): string {
  return [...Value.Errors(schema, value)].map((error) => `${error.path} ${error.message}`).join("; ");
}

export type ParsedClientMessage =
  | { kind: "turn.start"; request: StartTurnRequest }
  | { kind: "turn.tool_result"; turnId: string; result: ToolCallResult }
  | { kind: "models.list"; requestId: string; view: CatalogView }
  | { kind: "provider.status"; requestId: string }
  | { kind: "agent.cancel_turn"; requestId: string; turnId?: string };

export function parseClientMessage(raw: unknown): ParsedClientMessage {
  const parsed = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;

  if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
    throw new Error("WebSocket message must contain a type");
  }

  const typed = parsed as ClientMessage;
  if (typed.type === "turn.start") {
    if (!Value.Check(TurnStartMessageSchema, typed)) {
      throw new Error(schemaErrorText(TurnStartMessageSchema, typed));
    }

    const generation: StartTurnRequest["generation"] = {
      maxOutputTokens: typed.generation.max_output_tokens
    };

    if (typed.generation.temperature !== undefined) {
      generation.temperature = typed.generation.temperature;
    }

    if (typed.generation.reasoning_effort !== undefined) {
      generation.reasoningEffort = typed.generation.reasoning_effort;
    }

    if (typed.generation.response_format !== undefined) {
      generation.responseFormat = typed.generation.response_format;
    }

    if (typed.generation.strict_json_schema !== undefined) {
      generation.strictJsonSchema = typed.generation.strict_json_schema;
    }

    return {
      kind: "turn.start",
      request: {
        requestId: typed.request_id,
        profileId: typed.profile_id,
        messages: typed.messages,
        tools: (typed.tools ?? []).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.input_schema,
          strict: tool.strict
        })),
        generation
      }
    };
  }

  if (typed.type === "turn.tool_result") {
    if (!Value.Check(TurnToolResultMessageSchema, typed)) {
      throw new Error(schemaErrorText(TurnToolResultMessageSchema, typed));
    }

    return {
      kind: "turn.tool_result",
      turnId: typed.turn_id,
      result: {
        callId: typed.call_id,
        result: typed.result
      }
    };
  }

  if (typed.type === "models.list") {
    if (!Value.Check(ModelsListMessageSchema, typed)) {
      throw new Error(schemaErrorText(ModelsListMessageSchema, typed));
    }

    return { kind: "models.list", requestId: typed.request_id, view: typed.view ?? "default" };
  }

  if (typed.type === "provider.status") {
    if (!Value.Check(ProviderStatusMessageSchema, typed)) {
      throw new Error(schemaErrorText(ProviderStatusMessageSchema, typed));
    }

    return { kind: "provider.status", requestId: typed.request_id };
  }

  if (typed.type === "agent.cancel_turn") {
    if (!Value.Check(AgentCancelTurnMessageSchema, typed)) {
      throw new Error(schemaErrorText(AgentCancelTurnMessageSchema, typed));
    }

    const parsedCancel: { kind: "agent.cancel_turn"; requestId: string; turnId?: string } = {
      kind: "agent.cancel_turn",
      requestId: typed.request_id
    };
    if (typed.turn_id !== undefined) {
      parsedCancel.turnId = typed.turn_id;
    }
    return parsedCancel;
  }

  throw new Error("Unknown WebSocket message type");
}
