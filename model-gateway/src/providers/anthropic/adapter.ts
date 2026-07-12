import { GatewayError } from "../../kernel/errors.js";
import { createId } from "../../kernel/ids.js";
import { buildWireToolNameMap, sanitizeWireToolName } from "../../kernel/tool-names.js";
import { emptyTurnUsage } from "../../domain/usage.js";
import type { NormalizedReasoningEffort } from "../../domain/reasoning.js";
import type { GenerationOptions } from "../../application/capabilities/capability-negotiator.js";
import type { CanonicalMessage } from "../../domain/message.js";
import type { ModelDescriptor } from "../../domain/model.js";
import type { ModelToolDefinition, ToolCallResult } from "../../domain/tool.js";
import type { TurnUsage } from "../../domain/usage.js";
import type {
  ProviderAdapter,
  ProviderCredentialLease,
  ProviderEvent,
  ProviderResumeInput,
  ProviderTurnInput
} from "../../ports/provider-adapter.port.js";

/**
 * Adaptador de proveedor ANTHROPIC (paridad OpenClaw anthropic-messages provider). Habla la
 * Anthropic Messages API (POST /v1/messages con header `anthropic-version`), que es una
 * FAMILIA DE CABLE DISTINTA a la de OpenAI/opencode (chat/completions): aquí está el valor de
 * paridad — demostrar que el gateway maneja limpio un segundo protocolo de cable, no solo los
 * OpenAI-compatible.
 *
 * Diferencias clave de la forma de cable (todas manejadas aquí):
 *  - El `system` prompt es un campo TOP-LEVEL, no un mensaje (la capa SEGURIDAD+PERSONA+MEMORIA
 *    compuesta por el navegador se mapea al campo `system`).
 *  - El contenido son BLOQUES tipados: text / image / thinking / tool_use / tool_result.
 *  - Autenticación con `x-api-key` (no Bearer); la API key arrendada (B3, cifrada por usuario)
 *    llega por el puente de arriendo y NUNCA se almacena ni se loguea.
 *  - Razonamiento = "extended thinking" por PRESUPUESTO DE TOKENS (no un effort string): el
 *    nivel normalizado (P5, off..max) se mapea a un budget; se omite si el modelo no lo soporta.
 *
 * Relay de tools CLIENT-EXECUTA (el navegador ejecuta; el gateway NUNCA toca tools del negocio):
 * los bloques `tool_use` se mapean a nuestro protocolo de tool-call y, al reanudar, nuestros
 * resultados vuelven como bloques `tool_result`. Streaming acumulado a snapshot; capacidades
 * HONESTAS (lo desconocido es null/unknown, jamás un stub en el camino real). Aislamiento por
 * usuario: el lease es transitorio.
 */

export const ANTHROPIC_PROVIDER_ID = "anthropic";
// Versión de la Messages API requerida en cada request (header obligatorio de Anthropic).
const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicProviderOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

// Ventanas de contexto DOCUMENTADAS públicamente por familia Claude. No es un stub: son
// valores publicados; lo que no esté aquí queda como null (desconocido honesto). El /v1/models
// de Anthropic NO expone metadatos de capacidad, así que se curan aquí (mismo patrón honesto
// que opencode).
const ANTHROPIC_DOCUMENTED_CONTEXT: ReadonlyArray<readonly [RegExp, number]> = [
  [/^claude-/, 200000]
];

// Familias Claude con "extended thinking" (documentado): 3.7 y la serie 4.x. El resto, unknown.
const ANTHROPIC_THINKING_RE = /^claude-(3-7|opus-4|sonnet-4|haiku-4)/;

// Familias Claude con ENTRADA DE IMAGEN (visión, documentado). claude-3-5-haiku y claude-3-haiku
// son solo texto; el resto de 3.x sonnet/opus y toda la serie 4.x admiten imágenes.
const ANTHROPIC_VISION_RE = /^claude-(3-opus|3-sonnet|3-5-sonnet|3-7-sonnet|opus-4|sonnet-4|haiku-4)/;

// Presupuesto de "thinking" (tokens) por nivel normalizado. "max" usa el presupuesto más alto
// documentado que cabe holgado bajo los caps de salida típicos de Claude. "off" => sin thinking.
const ANTHROPIC_THINKING_BUDGETS: Readonly<Record<NormalizedReasoningEffort, number | null>> = {
  off: null,
  low: 2048,
  medium: 8192,
  high: 16384,
  max: 32768
};

function documentedContextWindow(modelId: string): number | null {
  for (const [re, window] of ANTHROPIC_DOCUMENTED_CONTEXT) {
    if (re.test(modelId)) {
      return window;
    }
  }
  return null;
}

// --- Tipos de cable Anthropic Messages (parcial). ----------------------------------

interface AnthropicTextBlock {
  type: "text";
  text: string;
}
interface AnthropicThinkingBlock {
  type: "thinking";
  thinking: string;
  signature: string;
}
interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}
interface AnthropicImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}
interface AnthropicDocumentBlock {
  type: "document";
  source: { type: "base64"; media_type: string; data: string };
}

type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicThinkingBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | AnthropicImageBlock
  | AnthropicDocumentBlock;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

// Evento SSE de la Messages API: cada `data:` lleva un `type` discriminante.
interface AnthropicStreamEvent {
  type: string;
  index?: number;
  message?: { usage?: AnthropicUsage | null };
  content_block?: { type?: string; id?: string; name?: string };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    signature?: string;
    partial_json?: string;
    stop_reason?: string | null;
  };
  usage?: AnthropicUsage | null;
  error?: { type?: string; message?: string };
}

interface AnthropicModelRow {
  id: string;
  display_name?: string;
  created_at?: string;
  type?: string;
}

// --- Estado de continuación. -------------------------------------------------------

interface AnthropicContinuationState {
  protocol: "anthropic_messages";
  system: string | null;
  messages: AnthropicMessage[];
  tools: AnthropicTool[];
  options: GenerationOptions;
  // Mapa nombre-saneado -> nombre-original de tool (kernel/tool-names.ts). Anthropic exige
  // nombres ^[a-zA-Z0-9_-]{1,64}$ (sin el punto de nuestros namespaces); el cable lleva el
  // saneado y la tool call emitida al navegador se revierte al original.
  toolNameMap: Record<string, string>;
}

function isAnthropicContinuationState(state: unknown): state is AnthropicContinuationState {
  const c = state as AnthropicContinuationState | null;
  return Boolean(c && c.protocol === "anthropic_messages" && Array.isArray(c.messages));
}

export class AnthropicProviderAdapter implements ProviderAdapter {
  readonly protocol = "anthropic_messages" as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AnthropicProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async discoverModels(credential: ProviderCredentialLease): Promise<ModelDescriptor[]> {
    // Anthropic SÍ expone GET /v1/models (lista de ids + display_name), pero NO trae metadatos
    // de capacidad: los ids se usan VERBATIM al enviar el turno y las capacidades se resuelven
    // por el mapa documentado de createAnthropicModel.
    const response = await this.fetchImpl(`${this.baseUrl}/models`, {
      method: "GET",
      headers: this.authHeaders(credential)
    });
    if (!response.ok) {
      throw new GatewayError(
        "PROVIDER_DISCOVERY_FAILED",
        `Anthropic model discovery failed with status ${response.status}`
      );
    }
    const payload = (await response.json()) as { data?: AnthropicModelRow[] } | null;
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows.map((row) => createAnthropicModel({ baseUrl: this.baseUrl, modelId: row.id, row }));
  }

  async *startTurn(input: ProviderTurnInput): AsyncIterable<ProviderEvent> {
    input.signal.throwIfAborted();
    const { system, messages } = toAnthropicMessages(input.messages);
    yield* this.runMessages({
      model: input.model,
      credential: input.credential,
      system,
      messages,
      tools: toAnthropicTools(input.tools),
      toolNameMap: buildWireToolNameMap(input.tools.map((tool) => tool.name)),
      options: input.options,
      signal: input.signal
    });
  }

  async *resumeTurn(input: ProviderResumeInput): AsyncIterable<ProviderEvent> {
    input.signal.throwIfAborted();
    const state = input.continuationState;
    if (!isAnthropicContinuationState(state)) {
      throw new GatewayError("INVALID_CONTINUATION_STATE", "Missing or invalid Anthropic continuation state");
    }

    // Los resultados de tool vuelven como un mensaje `user` con bloques tool_result (uno por
    // cada tool_use de la asistente). El navegador ejecutó la tool; el gateway solo reenvía.
    const toolResultMessage: AnthropicMessage = {
      role: "user",
      content: input.toolResults.map((result) => toToolResultBlock(result))
    };
    yield* this.runMessages({
      model: input.model,
      credential: input.credential,
      system: state.system,
      messages: [...state.messages, toolResultMessage],
      tools: state.tools,
      toolNameMap: state.toolNameMap ?? {},
      options: state.options,
      signal: input.signal
    });
  }

  private authHeaders(credential: ProviderCredentialLease): Record<string, string> {
    // La API key arrendada va SOLO aquí (x-api-key, no Bearer); nunca se loguea.
    return { "x-api-key": credential.secret, "anthropic-version": ANTHROPIC_VERSION };
  }

  private async *runMessages(params: {
    model: ModelDescriptor;
    credential: ProviderCredentialLease;
    system: string | null;
    messages: AnthropicMessage[];
    tools: AnthropicTool[];
    toolNameMap: Record<string, string>;
    options: GenerationOptions;
    signal: AbortSignal;
  }): AsyncGenerator<ProviderEvent> {
    const compat = params.model.capabilities.compat;

    // Presupuesto de "thinking" (extended thinking) a partir del nivel normalizado. Anthropic
    // cuenta el thinking DENTRO de max_tokens, así que se amplía el cap con el presupuesto
    // (clamp al max del modelo si se conoce). Si el presupuesto no cabe, se OMITE el thinking.
    let maxTokens = params.options.maxOutputTokens;
    let thinking: { type: "enabled"; budget_tokens: number } | null = null;
    const budget =
      compat.supportsReasoningEffort && params.options.reasoningEffort
        ? ANTHROPIC_THINKING_BUDGETS[params.options.reasoningEffort]
        : null;
    if (budget) {
      maxTokens = params.options.maxOutputTokens + budget;
      const cap = params.model.capabilities.maxOutputTokens;
      if (cap && maxTokens > cap) {
        maxTokens = cap;
      }
      if (maxTokens > budget) {
        thinking = { type: "enabled", budget_tokens: budget };
      } else {
        // El presupuesto no cabe bajo el cap del modelo: se omite el thinking por completo.
        maxTokens = params.options.maxOutputTokens;
      }
    }

    const body: Record<string, unknown> = {
      model: params.model.route.providerModelId,
      messages: params.messages,
      stream: true,
      max_tokens: maxTokens
    };
    if (params.system) {
      body.system = params.system;
    }
    if (params.tools.length > 0) {
      body.tools = params.tools;
      // Un tool a la vez: el navegador ejecuta de a una. disable_parallel_tool_use garantiza
      // un único tool_use por turno, así el round-trip tool_use -> tool_result es 1:1.
      body.tool_choice = { type: "auto", disable_parallel_tool_use: true };
    }
    if (thinking) {
      body.thinking = thinking;
      // Con thinking activo, Anthropic exige temperatura por defecto: se omite temperature.
    } else if (params.options.temperature !== undefined) {
      body.temperature = params.options.temperature;
    }

    const response = await this.fetchImpl(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.authHeaders(params.credential) },
      body: JSON.stringify(body),
      signal: params.signal
    });
    if (!response.ok) {
      throw new GatewayError(
        "PROVIDER_REQUEST_FAILED",
        `Anthropic messages request failed with status ${response.status}`
      );
    }
    if (!response.body) {
      throw new GatewayError("PROVIDER_REQUEST_FAILED", "Anthropic messages returned no body");
    }

    let usage: TurnUsage = emptyTurnUsage();
    let stopReason: string | null = null;
    // Bloques de contenido en ORDEN de índice (Anthropic emite thinking primero, luego texto y
    // tool_use). Se reconstruye el mensaje assistant verbatim para la continuación: con thinking
    // activo, Anthropic exige re-enviar los bloques thinking (con su firma) antes del tool_use.
    const blocks = new Map<
      number,
      | { kind: "text"; text: string }
      | { kind: "thinking"; thinking: string; signature: string }
      | { kind: "tool_use"; id: string; name: string; json: string }
    >();

    for await (const data of readServerSentEvents(response.body)) {
      let event: AnthropicStreamEvent;
      try {
        event = JSON.parse(data) as AnthropicStreamEvent;
      } catch {
        continue;
      }

      switch (event.type) {
        case "message_start": {
          if (event.message?.usage) {
            usage = mergeUsage(usage, event.message.usage);
          }
          break;
        }
        case "content_block_start": {
          const index = event.index ?? 0;
          const cb = event.content_block;
          if (cb?.type === "tool_use") {
            blocks.set(index, { kind: "tool_use", id: cb.id ?? "", name: cb.name ?? "", json: "" });
          } else if (cb?.type === "thinking") {
            blocks.set(index, { kind: "thinking", thinking: "", signature: "" });
          } else {
            blocks.set(index, { kind: "text", text: "" });
          }
          break;
        }
        case "content_block_delta": {
          const index = event.index ?? 0;
          const block = blocks.get(index);
          const delta = event.delta;
          if (!block || !delta) {
            break;
          }
          if (delta.type === "text_delta" && typeof delta.text === "string" && block.kind === "text") {
            block.text += delta.text;
            if (delta.text.length > 0) {
              yield { type: "text.delta", delta: delta.text };
            }
          } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string" && block.kind === "thinking") {
            block.thinking += delta.thinking;
            if (delta.thinking.length > 0) {
              yield { type: "reasoning.summary", summary: delta.thinking };
            }
          } else if (delta.type === "signature_delta" && typeof delta.signature === "string" && block.kind === "thinking") {
            block.signature += delta.signature;
          } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string" && block.kind === "tool_use") {
            block.json += delta.partial_json;
          }
          break;
        }
        case "message_delta": {
          if (event.delta?.stop_reason) {
            stopReason = event.delta.stop_reason;
          }
          if (event.usage) {
            usage = mergeUsage(usage, event.usage);
          }
          break;
        }
        case "message_stop": {
          break;
        }
        case "error": {
          throw new GatewayError(
            "PROVIDER_REQUEST_FAILED",
            event.error?.message ?? "Anthropic messages stream reported an error"
          );
        }
        default:
          break;
      }
    }

    const ordered = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, v]) => v);
    const toolUse = ordered.find((b) => b.kind === "tool_use");

    if (stopReason === "tool_use" && toolUse && toolUse.kind === "tool_use") {
      // Mensaje assistant verbatim para la continuación: thinking (con firma) + texto + el
      // tool_use que estamos reenviando (uno solo, por disable_parallel_tool_use).
      const assistantContent: AnthropicContentBlock[] = [];
      for (const block of ordered) {
        if (block.kind === "thinking" && block.thinking.length > 0) {
          assistantContent.push({ type: "thinking", thinking: block.thinking, signature: block.signature });
        } else if (block.kind === "text" && block.text.length > 0) {
          assistantContent.push({ type: "text", text: block.text });
        }
      }
      // El id se resuelve UNA vez: debe coincidir entre el historial reenviado y el evento al
      // cliente, o el tool_use_id del resultado no casaría al reanudar.
      const toolUseId = toolUse.id || createId("call");
      assistantContent.push({
        type: "tool_use",
        id: toolUseId,
        name: toolUse.name,
        input: safeParseJson(toolUse.json)
      });
      const continuationState: AnthropicContinuationState = {
        protocol: "anthropic_messages",
        system: params.system,
        messages: [...params.messages, { role: "assistant", content: assistantContent }],
        tools: params.tools,
        toolNameMap: params.toolNameMap,
        options: params.options
      };
      // El navegador ejecuta por el nombre ORIGINAL (con punto); Anthropic vio/emitió el
      // saneado, que se conserva verbatim en el historial reenviado (assistantContent).
      yield {
        type: "tool_call.ready",
        continuationState,
        call: {
          callId: toolUseId,
          name: params.toolNameMap[toolUse.name] ?? toolUse.name,
          arguments: safeParseJson(toolUse.json)
        }
      };
      return;
    }

    yield { type: "completed", usage };
  }
}

/**
 * Construye un ModelDescriptor Anthropic. El /v1/models de Anthropic no trae metadatos de
 * capacidad, así que la ventana de contexto, el soporte de visión y el de thinking salen de
 * mapas DOCUMENTADOS por familia; lo desconocido queda null/unknown (jamás un stub inventado).
 */
export function createAnthropicModel(input: {
  baseUrl: string;
  modelId: string;
  row?: AnthropicModelRow;
}): ModelDescriptor {
  const row = input.row;
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const supportsThinking = ANTHROPIC_THINKING_RE.test(input.modelId);
  const hasVision = ANTHROPIC_VISION_RE.test(input.modelId);
  const inputModalities = new Set<"text" | "image" | "audio" | "video" | "file">(["text"]);
  if (hasVision) {
    inputModalities.add("image");
  }
  const contextWindow = documentedContextWindow(input.modelId);

  return {
    id: `${ANTHROPIC_PROVIDER_ID}/${input.modelId}`,
    label: row?.display_name ?? input.modelId,
    route: {
      providerId: ANTHROPIC_PROVIDER_ID,
      providerModelId: input.modelId,
      protocol: "anthropic_messages",
      endpointBaseUrl: baseUrl
    },
    capabilities: {
      streaming: "supported",
      inputModalities,
      outputModalities: new Set(["text"]),
      toolCalling: {
        // Todas las familias Claude modernas soportan tools (documentado).
        support: "supported",
        strictSchema: "unknown",
        parallelCalls: "supported"
      },
      structuredOutput: {
        jsonObject: "unknown",
        jsonSchema: "unsupported",
        strictSchema: "unsupported"
      },
      reasoning: {
        support: supportsThinking ? "supported" : "unknown",
        allowedEfforts: supportsThinking ? ["low", "medium", "high"] : [],
        summaryOutput: supportsThinking ? "supported" : "unknown"
      },
      promptCaching: { read: "unknown", write: "unknown" },
      tokenCounting: { exact: "unsupported", estimated: "supported" },
      contextWindowTokens: contextWindow,
      effectiveContextTokens: null,
      maxOutputTokens: null,
      compat: {
        supportsTools: true,
        supportsReasoningEffort: supportsThinking,
        thinkingFormat: supportsThinking ? "anthropic_thinking" : "none",
        supportsStrictMode: false,
        supportsUsageInStreaming: true,
        supportsEagerToolInputStreaming: true
      }
    },
    source: row ? "discovered" : "curated",
    deprecatedAt: null
  };
}

// --- Helpers de mapeo. -------------------------------------------------------------

/**
 * Separa los mensajes canónicos en el campo `system` top-level (concatena todos los mensajes
 * `system`: capa SEGURIDAD + PERSONA + MEMORIA) y la lista `messages` (user/assistant) que
 * espera la Messages API. Los roles `tool` (defensivo) se degradan a `user`.
 */
function toAnthropicMessages(messages: CanonicalMessage[]): {
  system: string | null;
  messages: AnthropicMessage[];
} {
  const systemParts: string[] = [];
  const out: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      const text = message.content
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("");
      if (text.length > 0) {
        systemParts.push(text);
      }
      continue;
    }
    const role: "user" | "assistant" = message.role === "assistant" ? "assistant" : "user";
    out.push({ role, content: message.content.map((part) => toContentBlock(part)) });
  }
  return { system: systemParts.length > 0 ? systemParts.join("\n\n") : null, messages: out };
}

function toContentBlock(part: CanonicalMessage["content"][number]): AnthropicContentBlock {
  if (part.type === "text") {
    return { type: "text", text: part.text };
  }
  if (part.type === "image") {
    return { type: "image", source: { type: "base64", media_type: part.mimeType, data: part.data } };
  }
  return { type: "document", source: { type: "base64", media_type: part.mimeType, data: part.data } };
}

// El cable lleva el nombre SANEADO (Anthropic exige ^[a-zA-Z0-9_-]{1,64}$; ver
// kernel/tool-names.ts); la reversión al original usa el toolNameMap de la continuación.
function toAnthropicTools(tools: ModelToolDefinition[]): AnthropicTool[] {
  return tools.map((tool) => ({
    name: sanitizeWireToolName(tool.name),
    description: tool.description,
    input_schema: tool.inputSchema
  }));
}

function toToolResultBlock(result: ToolCallResult): AnthropicToolResultBlock {
  if (result.result.status === "success") {
    const content =
      typeof result.result.content === "string"
        ? result.result.content
        : JSON.stringify(result.result.content);
    return { type: "tool_result", tool_use_id: result.callId, content };
  }
  return {
    type: "tool_result",
    tool_use_id: result.callId,
    content: JSON.stringify({ error: { code: result.result.code, message: result.result.message } }),
    is_error: true
  };
}

function mergeUsage(current: TurnUsage, usage: AnthropicUsage): TurnUsage {
  return {
    inputTokens: usage.input_tokens ?? current.inputTokens,
    outputTokens: usage.output_tokens ?? current.outputTokens,
    cachedInputTokens: usage.cache_read_input_tokens ?? current.cachedInputTokens,
    // cache WRITE: Anthropic SÍ lo reporta (creación de caché de prompt).
    cacheWriteTokens: usage.cache_creation_input_tokens ?? current.cacheWriteTokens
  };
}

function safeParseJson(raw: string): unknown {
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: raw };
  }
}

/**
 * Parser SSE incremental sobre el ReadableStream. Emite el payload de cada línea `data:` (sin
 * el prefijo); ignora las líneas `event:` de Anthropic (el `type` viene dentro del JSON) y no
 * interpreta el JSON (lo hace el llamador).
 */
async function* readServerSentEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.startsWith("data:")) {
          yield line.slice(5).trim();
        }
      }
    }
    const remainder = buffer.trim();
    if (remainder.startsWith("data:")) {
      yield remainder.slice(5).trim();
    }
  } finally {
    reader.releaseLock();
  }
}
