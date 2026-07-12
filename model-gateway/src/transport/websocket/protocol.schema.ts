import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";

const TextContentPartSchema = Type.Object({
  type: Type.Literal("text"),
  text: Type.String()
});

// Parte de imagen: `mimeType`/`data` (data URL base64) en camelCase para mapear directo al
// CanonicalContentPart del dominio sin renombrar en el parser. Solo se acepta en modelos con
// visión (la negociación de capacidades lo valida).
const ImageContentPartSchema = Type.Object({
  type: Type.Literal("image"),
  mimeType: Type.String({ minLength: 1 }),
  data: Type.String({ minLength: 1 })
});

const ContentPartSchema = Type.Union([TextContentPartSchema, ImageContentPartSchema]);

const MessageSchema = Type.Object({
  role: Type.Union([
    Type.Literal("system"),
    Type.Literal("user"),
    Type.Literal("assistant"),
    Type.Literal("tool")
  ]),
  content: Type.Array(ContentPartSchema, { minItems: 1 })
});

const ToolSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  description: Type.String(),
  input_schema: Type.Record(Type.String(), Type.Unknown()),
  strict: Type.Boolean()
});

const GenerationSchema = Type.Object({
  max_output_tokens: Type.Integer({ minimum: 1 }),
  temperature: Type.Optional(Type.Number({ minimum: 0, maximum: 2 })),
  // Escala NORMALIZADA de razonamiento (P5). El gateway la traduce por proveedor; "off"
  // y los modelos sin soporte hacen que el parámetro se OMITA en el cable nativo.
  reasoning_effort: Type.Optional(
    Type.Union([
      Type.Literal("off"),
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
      Type.Literal("max")
    ])
  ),
  response_format: Type.Optional(Type.Union([Type.Literal("text"), Type.Literal("json_object"), Type.Literal("json_schema")])),
  strict_json_schema: Type.Optional(Type.Boolean())
});

export const TurnStartMessageSchema = Type.Object({
  type: Type.Literal("turn.start"),
  request_id: Type.String({ minLength: 1 }),
  profile_id: Type.String({ minLength: 1 }),
  messages: Type.Array(MessageSchema, { minItems: 1 }),
  tools: Type.Optional(Type.Array(ToolSchema)),
  generation: GenerationSchema
});

const ToolResultPayloadSchema = Type.Union([
  Type.Object({
    status: Type.Literal("success"),
    content: Type.Unknown()
  }),
  Type.Object({
    status: Type.Literal("error"),
    code: Type.String(),
    message: Type.String()
  })
]);

export const TurnToolResultMessageSchema = Type.Object({
  type: Type.Literal("turn.tool_result"),
  turn_id: Type.String({ minLength: 1 }),
  call_id: Type.String({ minLength: 1 }),
  result: ToolResultPayloadSchema
});

// B6: RPC de catálogo y verbos de control sobre el MISMO WS (patrón OpenClaw).
export const ModelsListMessageSchema = Type.Object({
  type: Type.Literal("models.list"),
  request_id: Type.String({ minLength: 1 }),
  view: Type.Optional(Type.Literal("default"))
});

export const ProviderStatusMessageSchema = Type.Object({
  type: Type.Literal("provider.status"),
  request_id: Type.String({ minLength: 1 })
});

export const AgentCancelTurnMessageSchema = Type.Object({
  type: Type.Literal("agent.cancel_turn"),
  request_id: Type.String({ minLength: 1 }),
  // Opcional: si se omite, cancela el/los turn(s) activo(s) de la sesión.
  turn_id: Type.Optional(Type.String({ minLength: 1 }))
});

export type TurnStartMessage = Static<typeof TurnStartMessageSchema>;
export type TurnToolResultMessage = Static<typeof TurnToolResultMessageSchema>;
export type ModelsListMessage = Static<typeof ModelsListMessageSchema>;
export type ProviderStatusMessage = Static<typeof ProviderStatusMessageSchema>;
export type AgentCancelTurnMessage = Static<typeof AgentCancelTurnMessageSchema>;
export type ClientMessage =
  | TurnStartMessage
  | TurnToolResultMessage
  | ModelsListMessage
  | ProviderStatusMessage
  | AgentCancelTurnMessage;
