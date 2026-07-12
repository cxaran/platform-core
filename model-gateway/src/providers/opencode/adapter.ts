import { GatewayError } from "../../kernel/errors.js";
import { createId } from "../../kernel/ids.js";
import { buildWireToolNameMap, sanitizeWireToolName } from "../../kernel/tool-names.js";
import { emptyTurnUsage } from "../../domain/usage.js";
import { nativeReasoningEffort } from "../../domain/reasoning.js";
import { opencodeCuratedFor, type OpencodeCuratedEntry } from "./catalog.js";
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

/** Identificadores de proveedor opencode (alineados con AiProvider del backend). */
export type OpencodeProviderId = "opencode_zen" | "opencode_go";
export const OPENCODE_PROVIDER_ID: OpencodeProviderId = "opencode_zen";
export const OPENCODE_GO_PROVIDER_ID: OpencodeProviderId = "opencode_go";

// Modelos opencode con ENTRADA DE IMAGEN (visión). El /models de opencode NO expone
// modalidades, así que se curan aquí (alineado con el catálogo de OpenClaw). Si el row de
// /models sí trae `modalities`, ese metadato tiene prioridad sobre esta tabla.
const OPENCODE_VISION_MODEL_IDS = new Set<string>([
  "kimi-k2.5",
  "kimi-k2.6",
  "kimi-k2.7-code",
  "mimo-v2-omni",
  "mimo-v2.5",
  "qwen3.5-plus",
  "qwen3.6-plus",
  "qwen3.7-plus"
]);

/**
 * ¿El modelo opencode acepta imágenes? Cura por id (sufijo ``-free`` ignorado) más las
 * familias multimodales conocidas de Zen (Claude, Gemini). El resto se asume text-only de
 * forma honesta (no se inventa visión). minimax-m3, deepseek-* y glm-* son text-only.
 */
export function opencodeSupportsVision(modelId: string): boolean {
  const base = modelId.replace(/-free$/, "");
  if (OPENCODE_VISION_MODEL_IDS.has(base)) {
    return true;
  }
  return /^(claude-|gemini-)/.test(base);
}

export interface OpencodeProviderOptions {
  baseUrl: string;
  // Distingue Zen de Go: misma forma de cable (OpenAI-compatible) pero distinto
  // provider id (para arrendar la credencial correcta) y base URL. Default: zen.
  providerId?: OpencodeProviderId;
  fetchImpl?: typeof fetch;
}

// --- Tipos de cable OpenAI-compatible (parcial, solo lo que usamos). -------------

interface OpenAITextToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | OpenAIContentPart[] | null;
  tool_calls?: OpenAITextToolCall[];
  tool_call_id?: string;
}

type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface OpenAITool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown>; strict?: boolean };
}

interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

interface OpenAIStreamChoiceDelta {
  content?: string | null;
  reasoning?: string | null;
  reasoning_content?: string | null;
  tool_calls?: {
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }[];
}

interface OpenAIStreamChunk {
  choices?: { delta?: OpenAIStreamChoiceDelta; finish_reason?: string | null }[];
  usage?: OpenAIUsage | null;
}

interface OpenAIModelRow {
  id: string;
  name?: string;
  created?: number;
  context_length?: number;
  context_window?: number;
  max_output_tokens?: number;
  max_tokens?: number;
  supports_tools?: boolean;
  supports_reasoning?: boolean;
  modalities?: string[];
}

// Estado de continuación específico de opencode: el historial OpenAI (incl. el mensaje
// assistant con tool_calls) más las tools y opciones para reanudar /chat/completions.
interface OpencodeContinuationState {
  protocol: OpencodeProviderId;
  messages: OpenAIMessage[];
  tools: OpenAITool[];
  options: GenerationOptions;
  // Mapa nombre-saneado -> nombre-original de tool. Los nombres con '.' (namespacing del
  // copiloto, p. ej. "example.list_patients") violan el patrón ^[a-zA-Z0-9_-]{1,64}$ que
  // exigen OpenAI/Anthropic y algunos upstreams (DeepSeek vía opencode) rechazan con 400.
  // Se sanea al enviar y se revierte al emitir la tool call al cliente, que conoce el original.
  toolNameMap: Record<string, string>;
  // Tool calls PARALELAS del mismo mensaje assistant aún sin despachar al navegador. El gateway
  // relay-a una a la vez (waiting_for_tool); estas se drenan en resumeTurn ANTES de volver al
  // proveedor. Sin esto, el cable queda inválido: el assistant declara N tool_calls pero solo
  // llega 1 mensaje tool, y upstreams estrictos (DeepSeek) rechazan con 400.
  pendingCalls?: { id: string; name: string; args: string }[];
}

function isOpencodeContinuationState(state: unknown): state is OpencodeContinuationState {
  const candidate = state as OpencodeContinuationState | null;
  return Boolean(
    candidate &&
      (candidate.protocol === OPENCODE_PROVIDER_ID || candidate.protocol === OPENCODE_GO_PROVIDER_ID) &&
      Array.isArray(candidate.messages)
  );
}

/**
 * Primer proveedor REAL del gateway (B5): adaptador opencode zen, OpenAI-compatible.
 *
 * Usa la credencial ARRENDADA (B4) en cada llamada (Authorization: Bearer <secret>);
 * el secreto NUNCA se loguea (el adaptador no escribe logs). El base URL es configurable
 * (provisional; se afina en B13 con la key real). Todo el HTTP se prueba mockeado.
 */
export class OpencodeProviderAdapter implements ProviderAdapter {
  readonly protocol: OpencodeProviderId;
  private readonly providerId: OpencodeProviderId;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpencodeProviderOptions) {
    this.providerId = options.providerId ?? OPENCODE_PROVIDER_ID;
    this.protocol = this.providerId;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async discoverModels(credential: ProviderCredentialLease): Promise<ModelDescriptor[]> {
    const response = await this.fetchImpl(`${this.baseUrl}/models`, {
      method: "GET",
      headers: this.authHeaders(credential)
    });
    if (!response.ok) {
      throw new GatewayError(
        "PROVIDER_DISCOVERY_FAILED",
        `Opencode model discovery failed with status ${response.status}`
      );
    }

    const payload = (await response.json()) as { data?: OpenAIModelRow[] } | null;
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows.map((row) => this.toDescriptor(row));
  }

  async *startTurn(input: ProviderTurnInput): AsyncIterable<ProviderEvent> {
    input.signal.throwIfAborted();
    const messages = toOpenAIMessages(input.messages);
    const tools = toOpenAITools(input.tools);
    const toolNameMap = buildToolNameMap(input.tools);
    yield* this.runCompletion({
      model: input.model,
      credential: input.credential,
      messages,
      tools,
      toolNameMap,
      options: input.options,
      signal: input.signal
    });
  }

  async *resumeTurn(input: ProviderResumeInput): AsyncIterable<ProviderEvent> {
    input.signal.throwIfAborted();
    const state = input.continuationState;
    if (!isOpencodeContinuationState(state)) {
      throw new GatewayError(
        "INVALID_CONTINUATION_STATE",
        "Missing or invalid opencode continuation state"
      );
    }

    const toolMessages: OpenAIMessage[] = input.toolResults.map((result) => ({
      role: "tool",
      tool_call_id: result.callId,
      content: toolResultContent(result)
    }));
    const messages = [...state.messages, ...toolMessages];

    // Si el assistant pidió varias tools en paralelo, se despacha la SIGUIENTE al navegador sin
    // llamar al proveedor: el cable exige un mensaje tool por cada tool_call_id antes de reanudar.
    const pending = state.pendingCalls ?? [];
    const nextCall = pending[0];
    if (nextCall) {
      const continuationState: OpencodeContinuationState = {
        ...state,
        messages,
        pendingCalls: pending.slice(1)
      };
      yield {
        type: "tool_call.ready",
        continuationState,
        call: {
          callId: nextCall.id,
          name: (state.toolNameMap ?? {})[nextCall.name] ?? nextCall.name,
          arguments: safeParseJson(nextCall.args)
        }
      };
      return;
    }

    yield* this.runCompletion({
      model: input.model,
      credential: input.credential,
      messages,
      tools: state.tools,
      toolNameMap: state.toolNameMap ?? {},
      options: state.options,
      signal: input.signal
    });
  }

  private authHeaders(credential: ProviderCredentialLease): Record<string, string> {
    // El secreto arrendado va SOLO en el header Authorization; nunca se loguea.
    return { authorization: `Bearer ${credential.secret}` };
  }

  private async *runCompletion(params: {
    model: ModelDescriptor;
    credential: ProviderCredentialLease;
    messages: OpenAIMessage[];
    tools: OpenAITool[];
    toolNameMap: Record<string, string>;
    options: GenerationOptions;
    signal: AbortSignal;
  }): AsyncGenerator<ProviderEvent> {
    const compat = params.model.capabilities.compat;
    // Red de seguridad del cable: garantiza el invariante tool_calls↔tool ANTES de enviar. Si un
    // turno murió a mitad del drenado de tool calls paralelas (timeout, resume fuera de orden) o el
    // modelo emitió ids duplicados, el historial podría llevar un assistant con N tool_calls sin sus
    // N mensajes tool → upstreams estrictos (DeepSeek vía opencode) responden 400 "insufficient tool
    // messages following tool_calls message". Idempotente: en el camino feliz no cambia nada.
    const wireMessages = normalizeToolSequence(params.messages);
    const body: Record<string, unknown> = {
      model: params.model.route.providerModelId,
      messages: wireMessages,
      stream: true,
      max_tokens: params.options.maxOutputTokens
    };
    if (params.tools.length > 0) {
      body.tools = params.tools;
      body.tool_choice = "auto";
    }
    if (params.options.temperature !== undefined) {
      body.temperature = params.options.temperature;
    }
    if (compat.supportsUsageInStreaming) {
      body.stream_options = { include_usage: true };
    }
    if (params.options.responseFormat === "json_object") {
      body.response_format = { type: "json_object" };
    }
    // Nivel normalizado -> parámetro nativo (low|medium|high; "max"->"high"). Solo se envía
    // si el modelo soporta el control (compat) y el mapeo da un valor; si no, se OMITE.
    const reasoningEffort =
      compat.supportsReasoningEffort
        ? nativeReasoningEffort(params.model.route.protocol, params.options.reasoningEffort)
        : null;
    if (reasoningEffort) {
      body.reasoning_effort = reasoningEffort;
    }

    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.authHeaders(params.credential) },
      body: JSON.stringify(body),
      signal: params.signal
    });

    if (!response.ok) {
      // DIAGNÓSTICO: capturamos el error del proveedor (p. ej. el 400 de opencode que indica
      // qué campo del body rechaza) en los detalles del error. Antes se descartaba y las QA
      // nunca revelaban la causa. No contiene secretos ni datos sensibles (describe la forma de la
      // petición) y va a los detalles del error (visibles en QA), nunca a los logs de telemetría.
      const providerError = await readProviderError(response);
      throw new GatewayError(
        "PROVIDER_REQUEST_FAILED",
        `Opencode chat completion failed with status ${response.status}` +
          (providerError ? `: ${providerError}` : ""),
        { providerStatus: response.status, providerError }
      );
    }
    if (!response.body) {
      throw new GatewayError("PROVIDER_REQUEST_FAILED", "Opencode chat completion returned no body");
    }

    let assistantText = "";
    let usage: TurnUsage = emptyTurnUsage();
    let finishReason: string | null = null;
    const toolAccumulators = new Map<number, { id: string; name: string; args: string }>();

    for await (const data of readServerSentEvents(response.body)) {
      if (data === "[DONE]") {
        break;
      }

      let chunk: OpenAIStreamChunk;
      try {
        chunk = JSON.parse(data) as OpenAIStreamChunk;
      } catch {
        continue;
      }

      if (chunk.usage) {
        usage = mapUsage(chunk.usage);
      }

      const choice = chunk.choices?.[0];
      if (!choice) {
        continue;
      }

      const delta = choice.delta ?? {};
      if (typeof delta.content === "string" && delta.content.length > 0) {
        assistantText += delta.content;
        yield { type: "text.delta", delta: delta.content };
      }

      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (typeof reasoning === "string" && reasoning.length > 0) {
        yield { type: "reasoning.summary", summary: reasoning };
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const toolCallDelta of delta.tool_calls) {
          const index = toolCallDelta.index ?? 0;
          const current = toolAccumulators.get(index) ?? { id: "", name: "", args: "" };
          if (toolCallDelta.id) {
            current.id = toolCallDelta.id;
          }
          if (toolCallDelta.function?.name) {
            current.name = toolCallDelta.function.name;
          }
          if (toolCallDelta.function?.arguments) {
            current.args += toolCallDelta.function.arguments;
          }
          toolAccumulators.set(index, current);
        }
      }

      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }
    }

    if (finishReason === "tool_calls" || toolAccumulators.size > 0) {
      // Los ids se resuelven UNA vez: el id del evento al cliente y el del historial reenviado
      // al proveedor deben coincidir, o el tool_call_id del resultado no casaría al reanudar.
      const calls = [...toolAccumulators.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, value]) => ({ id: value.id || createId("call"), name: value.name, args: value.args }));
      const first = calls[0];
      if (!first) {
        // finish_reason=tool_calls sin acumular ninguna: trátalo como completado.
        yield { type: "completed", usage };
        return;
      }

      const assistantMessage: OpenAIMessage = {
        role: "assistant",
        content: assistantText.length > 0 ? assistantText : null,
        tool_calls: calls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.args }
        }))
      };

      const continuationState: OpencodeContinuationState = {
        protocol: this.providerId,
        messages: [...params.messages, assistantMessage],
        tools: params.tools,
        toolNameMap: params.toolNameMap,
        options: params.options,
        // Las tool calls paralelas restantes se drenan una a una en resumeTurn.
        pendingCalls: calls.slice(1)
      };

      // El gateway reenvía una tool call por vez (waiting_for_tool); se emite la primera.
      // El nombre se revierte al original (con '.') que conoce el cliente; el historial
      // reenviado al proveedor (assistantMessage) conserva el saneado que él mismo emitió.
      yield {
        type: "tool_call.ready",
        continuationState,
        call: {
          callId: first.id,
          name: params.toolNameMap[first.name] ?? first.name,
          arguments: safeParseJson(first.args)
        }
      };
      return;
    }

    // Truncamiento: el proveedor cortó por límite de longitud (``finish_reason: "length"``) o el
    // stream terminó SIN señal de fin dejando texto a medias (conexión caída / [DONE] prematuro).
    // En ambos casos el mensaje quedó incompleto y el cliente debe avisarlo (Fix: mensajes cortados
    // que antes se persistían como respuesta normal, p. ej. "Permítame retomar. U").
    const truncated = finishReason === "length" || (finishReason === null && assistantText.length > 0);
    // Sólo se anexa ``truncated`` cuando es true: el camino feliz emite el evento tal cual.
    yield truncated ? { type: "completed", usage, truncated: true } : { type: "completed", usage };
  }

  private toDescriptor(row: OpenAIModelRow): ModelDescriptor {
    return createOpencodeModel({
      baseUrl: this.baseUrl,
      modelId: row.id,
      row,
      providerId: this.providerId
    });
  }
}

/**
 * Construye un ModelDescriptor de opencode con capacidades OpenAI-compatible. Si se pasa
 * una fila de /models (`row`), se enriquece desde sus metadatos; donde falten, defaults.
 */
export function createOpencodeModel(input: {
  baseUrl: string;
  modelId: string;
  row?: OpenAIModelRow;
  providerId?: OpencodeProviderId;
  // Override del mapa curado (sólo para tests del mecanismo de precedencia); por defecto se
  // consulta el mapa curado real por id.
  curated?: OpencodeCuratedEntry;
}): ModelDescriptor {
  const row = input.row;
  const providerId = input.providerId ?? OPENCODE_PROVIDER_ID;
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  // Mapa curado (rellena huecos donde opencode no reporta nada). PRECEDENCIA estricta: el dato
  // REAL del proveedor (row) gana SIEMPRE; el curado sólo rellena; lo desconocido-y-no-curado
  // queda en su default honesto. El curado JAMÁS sobrescribe un valor real.
  const curated = input.curated ?? opencodeCuratedFor(input.modelId);
  const supportsTools = row?.supports_tools ?? curated?.supportsTools ?? true;
  const supportsReasoning = row?.supports_reasoning ?? curated?.supportsReasoning ?? false;
  // Si /models trae `modalities`, ese metadato manda; si no, cae al curado y, por último, a
  // `opencodeSupportsVision` (curación por id existente).
  const hasVision = row?.modalities
    ? row.modalities.includes("image")
    : (curated?.vision ?? opencodeSupportsVision(input.modelId));
  const inputModalities = new Set<"text" | "image" | "audio" | "video" | "file">(["text"]);
  if (hasVision) {
    inputModalities.add("image");
  }
  const contextWindow =
    row?.context_length ?? row?.context_window ?? curated?.contextWindowTokens ?? 128000;
  const maxOutput = row?.max_output_tokens ?? row?.max_tokens ?? curated?.maxOutputTokens ?? null;
  // opencode NO publica precios en /models -> el precio sólo puede venir del mapa curado (o null).
  const pricing = curated?.pricing ?? null;
  // Provenance: capacidades del proveedor si hay row (mixed si además hubo curado); pricing siempre
  // curado o ninguno (el proveedor no lo reporta).
  const enrichment: ModelDescriptor["enrichment"] = {
    capabilities: row ? (curated ? "mixed" : "provider") : curated ? "curated" : "none",
    pricing: pricing ? "curated" : "none",
  };

  return {
    pricing,
    enrichment,
    id: `${providerId}/${input.modelId}`,
    label: row?.name ?? input.modelId,
    route: {
      providerId,
      providerModelId: input.modelId,
      protocol: providerId,
      endpointBaseUrl: baseUrl
    },
    capabilities: {
      streaming: "supported",
      inputModalities,
      outputModalities: new Set(["text"]),
      toolCalling: {
        support: supportsTools ? "supported" : "unsupported",
        strictSchema: "unknown",
        parallelCalls: "supported"
      },
      structuredOutput: {
        jsonObject: "supported",
        jsonSchema: "unknown",
        strictSchema: "unknown"
      },
      reasoning: {
        support: supportsReasoning ? "supported" : "unknown",
        allowedEfforts: supportsReasoning ? ["low", "medium", "high"] : [],
        summaryOutput: "unknown"
      },
      promptCaching: { read: "unknown", write: "unknown" },
      tokenCounting: { exact: "unsupported", estimated: "supported" },
      contextWindowTokens: contextWindow,
      effectiveContextTokens: null,
      maxOutputTokens: maxOutput,
      compat: {
        supportsTools,
        supportsReasoningEffort: supportsReasoning,
        thinkingFormat: supportsReasoning ? "openai_reasoning_effort" : "none",
        supportsStrictMode: false,
        supportsUsageInStreaming: true,
        supportsEagerToolInputStreaming: true
      }
    },
    source: row ? "discovered" : "curated",
    deprecatedAt: null
  };
}

// --- Helpers de mapeo y parsing. --------------------------------------------------

function toOpenAIMessages(messages: CanonicalMessage[]): OpenAIMessage[] {
  return messages.map((message) => {
    const onlyText = message.content.every((part) => part.type === "text");
    if (onlyText) {
      const text = message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
      return { role: message.role, content: text };
    }

    const parts: OpenAIContentPart[] = message.content.map((part) => {
      if (part.type === "text") {
        return { type: "text", text: part.text };
      }
      return { type: "image_url", image_url: { url: `data:${part.mimeType};base64,${part.data}` } };
    });
    return { role: message.role, content: parts };
  });
}

// Sanea un nombre de tool al patrón aceptado por OpenAI/Anthropic y upstreams estrictos
// (^[a-zA-Z0-9_-]{1,64}$). Criterio canónico compartido en kernel/tool-names.ts; la
// reversión usa el mapa construido por buildToolNameMap.
function sanitizeToolName(name: string): string {
  return sanitizeWireToolName(name);
}

// Mapa nombre-saneado -> nombre-original, para revertir el nombre de la tool call que emite
// el proveedor (que ve el saneado) al original que conoce el cliente.
function buildToolNameMap(tools: ModelToolDefinition[]): Record<string, string> {
  return buildWireToolNameMap(tools.map((tool) => tool.name));
}

function toOpenAITools(tools: ModelToolDefinition[]): OpenAITool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: sanitizeToolName(tool.name),
      description: tool.description,
      parameters: tool.inputSchema,
      ...(tool.strict ? { strict: true } : {})
    }
  }));
}

/**
 * Repara la secuencia de mensajes OpenAI para que cumpla el invariante del cable ANTES de
 * enviarla al proveedor: cada ``tool_call`` declarado por un mensaje ``assistant`` tiene
 * EXACTAMENTE un mensaje ``tool`` que lo responde, y no quedan mensajes ``tool`` huérfanos.
 * Los upstreams estrictos (DeepSeek vía opencode) devuelven 400 si el invariante se rompe,
 * cosa que puede pasar cuando un turno muere a mitad del drenado de tool calls paralelas o
 * el modelo emite ids duplicados. Reglas:
 *   - Los ``tool_calls`` de un assistant se deduplican por id (se conserva el primero).
 *   - Un ``tool_call`` sin su mensaje ``tool`` de respuesta se DESCARTA (no se pudo completar).
 *   - Si tras la poda el assistant se queda sin ``tool_calls``, se conserva sólo si tiene texto
 *     (como mensaje de texto); si no, se descarta entero.
 *   - Los mensajes ``tool`` que no casan con ningún ``tool_call`` conservado se descartan.
 * Idempotente y no-op en el camino feliz. No muta la entrada.
 */
export function normalizeToolSequence(messages: OpenAIMessage[]): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i]!;

    if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      // Agrupa los mensajes ``tool`` que siguen inmediatamente a este assistant.
      let j = i + 1;
      const following: OpenAIMessage[] = [];
      while (j < messages.length && messages[j]!.role === "tool") {
        following.push(messages[j]!);
        j += 1;
      }
      const answeredIds = new Set(
        following.map((tool) => tool.tool_call_id).filter((id): id is string => Boolean(id))
      );

      // Dedup por id + conserva sólo los tool_calls que tengan respuesta.
      const seen = new Set<string>();
      const keptCalls: OpenAITextToolCall[] = [];
      for (const call of msg.tool_calls) {
        if (seen.has(call.id) || !answeredIds.has(call.id)) {
          continue;
        }
        seen.add(call.id);
        keptCalls.push(call);
      }

      if (keptCalls.length === 0) {
        // Ningún tool_call quedó respondido: conserva el assistant como texto si lo tiene.
        if (typeof msg.content === "string" ? msg.content.length > 0 : msg.content !== null) {
          result.push({ role: "assistant", content: msg.content });
        }
      } else {
        result.push({ ...msg, tool_calls: keptCalls });
        // Conserva un solo mensaje tool por id conservado, en orden; descarta huérfanos/duplicados.
        const keptIds = new Set(keptCalls.map((call) => call.id));
        const used = new Set<string>();
        for (const tool of following) {
          const id = tool.tool_call_id;
          if (!id || !keptIds.has(id) || used.has(id)) {
            continue;
          }
          used.add(id);
          result.push(tool);
        }
      }
      i = j;
      continue;
    }

    // Mensaje ``tool`` sin un assistant con tool_calls que lo preceda: huérfano, se descarta.
    if (msg.role === "tool") {
      i += 1;
      continue;
    }

    result.push(msg);
    i += 1;
  }
  return result;
}

function toolResultContent(result: ToolCallResult): string {
  if (result.result.status === "success") {
    return typeof result.result.content === "string"
      ? result.result.content
      : JSON.stringify(result.result.content);
  }
  return JSON.stringify({ error: { code: result.result.code, message: result.result.message } });
}

function mapUsage(usage: OpenAIUsage): TurnUsage {
  return {
    inputTokens: usage.prompt_tokens ?? null,
    outputTokens: usage.completion_tokens ?? null,
    cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? null,
    cacheWriteTokens: null
  };
}

/**
 * Lee y acota el cuerpo de error del proveedor para DIAGNÓSTICO. Prefiere los campos
 * estructurados del error OpenAI-compatible (``error.message/type/param/code``) y cae al texto
 * crudo; en ambos casos colapsa espacios y trunca a 300 caracteres. Devuelve ``null`` si no hay
 * cuerpo o no se puede leer. La descripción del error es sobre la FORMA de la petición, no datos
 * del negocio; aun así se acota para minimizar cualquier eco accidental del request.
 */
async function readProviderError(response: Response): Promise<string | null> {
  let raw: string;
  try {
    raw = await response.text();
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }
  const clamp = (value: string): string => value.replace(/\s+/g, " ").trim().slice(0, 300);
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: unknown; type?: unknown; param?: unknown; code?: unknown } };
    const error = parsed?.error;
    if (error && typeof error === "object") {
      const fields = [error.message, error.code, error.param, error.type]
        .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
        .map(String);
      if (fields.length > 0) {
        return clamp(fields.join(" · "));
      }
    }
  } catch {
    // No es JSON: cae al texto crudo acotado.
  }
  return clamp(raw) || null;
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
 * Parser SSE incremental sobre el ReadableStream de la respuesta. Emite el payload de
 * cada línea `data:` (sin el prefijo). No interpreta el JSON: eso lo hace el llamador.
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
