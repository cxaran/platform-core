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
 * Adaptador de proveedor GOOGLE GEMINI (paridad OpenClaw gemini provider). Habla la Generative
 * Language API (generateContent / streamGenerateContent), que es una TERCERA familia de cable
 * distinta a OpenAI (chat/completions) y Anthropic (messages): refuerza que el gateway es
 * genuinamente provider-neutral.
 *
 * Diferencias clave de la forma de cable (todas manejadas aquí):
 *  - Endpoint por modelo y verbo: POST /v1beta/models/{id}:streamGenerateContent?alt=sse.
 *  - Roles "user"/"model" (no "assistant"); el system es un campo TOP-LEVEL `systemInstruction`
 *    (la capa compuesta SEGURIDAD+PERSONA+MEMORIA del navegador se mapea ahí).
 *  - Contenido en `parts` tipadas: text / inlineData (imágenes) / functionCall / functionResponse.
 *  - Autenticación por header `x-goog-api-key` (NO query param, NO Bearer); la API key arrendada
 *    (B3, cifrada por usuario) llega por el puente de arriendo y NUNCA se almacena ni se loguea.
 *  - Razonamiento = `thinkingConfig.thinkingBudget` (tokens); el nivel normalizado (P5, off..max)
 *    se mapea a un budget; se omite si el modelo no lo soporta. A diferencia de Anthropic, el
 *    budget es un knob SEPARADO de maxOutputTokens (no se amplía el cap de salida).
 *
 * Relay de function-calling CLIENT-EJECUTA (el navegador ejecuta; el gateway NUNCA toca tools
 * del negocio): los `functionCall` se mapean a nuestro protocolo de tool-call y, al reanudar,
 * nuestros resultados vuelven como `functionResponse`. Gemini correla por NOMBRE de función (no
 * hay call id en el cable), así que el nombre pendiente se guarda en el estado de continuación.
 * Las functionCalls PARALELAS se drenan una a una en resumeTurn (el navegador ejecuta de a una)
 * y solo al tener TODOS los resultados se reanuda al proveedor con los functionResponse juntos,
 * en el orden del cable, dentro de un mismo content `user`.
 * Streaming acumulado a snapshot; capacidades HONESTAS (lo desconocido es null/unknown, jamás un
 * stub en el camino real). Aislamiento por usuario: el lease es transitorio.
 */

export const GEMINI_PROVIDER_ID = "gemini";

export interface GeminiProviderOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

// Familias Gemini con "thinking" (documentado): serie 2.5. El resto, unknown.
const GEMINI_THINKING_RE = /gemini-2\.5/;

// Presupuesto de "thinking" (tokens) por nivel normalizado. "max" usa un tope que cabe en el
// rango de TODAS las familias 2.5 (flash llega a 24576). "off" => sin thinking.
const GEMINI_THINKING_BUDGETS: Readonly<Record<NormalizedReasoningEffort, number | null>> = {
  off: null,
  low: 2048,
  medium: 8192,
  high: 16384,
  max: 24576
};

// --- Tipos de cable Gemini (parcial). ----------------------------------------------

interface GeminiTextPart {
  text: string;
  thought?: boolean;
}
interface GeminiInlineDataPart {
  inlineData: { mimeType: string; data: string };
}
interface GeminiFunctionCallPart {
  functionCall: { name: string; args?: Record<string, unknown> };
}
interface GeminiFunctionResponsePart {
  functionResponse: { name: string; response: Record<string, unknown> };
}

type GeminiPart =
  | GeminiTextPart
  | GeminiInlineDataPart
  | GeminiFunctionCallPart
  | GeminiFunctionResponsePart;

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiTool {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  cachedContentTokenCount?: number;
}

interface GeminiStreamChunk {
  candidates?: Array<{
    content?: { role?: string; parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: GeminiUsageMetadata | null;
  error?: { message?: string };
}

interface GeminiModelRow {
  name: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
}

// --- Estado de continuación. -------------------------------------------------------

interface GeminiPendingFunctionCall {
  // Nombre DE CABLE (saneado) tal como lo emitió el proveedor; la reversión al original
  // ocurre al emitir el tool_call.ready (toolNameMap).
  name: string;
  args: Record<string, unknown>;
}

interface GeminiContinuationState {
  protocol: "gemini_generate_content";
  systemInstruction: { parts: GeminiTextPart[] } | null;
  contents: GeminiContent[];
  tools: GeminiTool[];
  options: GenerationOptions;
  // Gemini correla la respuesta de función por NOMBRE DE CABLE (saneado); se guarda el de la
  // llamada DESPACHADA al navegador (la que espera resultado en el próximo resume).
  pendingToolName: string;
  // functionCalls PARALELAS del mismo turno `model` aún sin despachar al navegador. El gateway
  // relay-a una a la vez; se drenan en la reanudación ANTES de volver al proveedor (Gemini
  // exige un functionResponse por CADA functionCall del turno model, todos juntos en el mismo
  // content `user`).
  pendingCalls?: GeminiPendingFunctionCall[];
  // functionResponse ya construidos (en el ORDEN del cable) a la espera de que se drenen las
  // pendientes; al no quedar ninguna se reanuda al proveedor con todos juntos.
  collectedResponses?: GeminiFunctionResponsePart[];
  // Mapa nombre-saneado -> nombre-original de tool (kernel/tool-names.ts). Gemini exige
  // nombres de función sin el punto de nuestros namespaces; el cable lleva el saneado y la
  // tool call emitida al navegador se revierte al original.
  toolNameMap: Record<string, string>;
}

function isGeminiContinuationState(state: unknown): state is GeminiContinuationState {
  const c = state as GeminiContinuationState | null;
  return Boolean(c && c.protocol === "gemini_generate_content" && Array.isArray(c.contents));
}

function isTextPart(part: GeminiPart): part is GeminiTextPart {
  return typeof (part as GeminiTextPart).text === "string";
}
function isFunctionCallPart(part: GeminiPart): part is GeminiFunctionCallPart {
  return typeof (part as GeminiFunctionCallPart).functionCall === "object";
}

export class GeminiProviderAdapter implements ProviderAdapter {
  readonly protocol = "gemini_generate_content" as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GeminiProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async discoverModels(credential: ProviderCredentialLease): Promise<ModelDescriptor[]> {
    // GET /v1beta/models trae inputTokenLimit/outputTokenLimit y supportedGenerationMethods:
    // se filtra a los que soportan generateContent (los demás son embeddings/otros).
    const response = await this.fetchImpl(`${this.baseUrl}/models`, {
      method: "GET",
      headers: this.authHeaders(credential)
    });
    if (!response.ok) {
      throw new GatewayError(
        "PROVIDER_DISCOVERY_FAILED",
        `Gemini model discovery failed with status ${response.status}`
      );
    }
    const payload = (await response.json()) as { models?: GeminiModelRow[] } | null;
    const rows = Array.isArray(payload?.models) ? payload.models : [];
    return rows
      .filter((row) => (row.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((row) => createGeminiModel({ baseUrl: this.baseUrl, modelId: stripModelsPrefix(row.name), row }));
  }

  async *startTurn(input: ProviderTurnInput): AsyncIterable<ProviderEvent> {
    input.signal.throwIfAborted();
    const { systemInstruction, contents } = toGeminiContents(input.messages);
    yield* this.runGenerate({
      model: input.model,
      credential: input.credential,
      systemInstruction,
      contents,
      tools: toGeminiTools(input.tools),
      toolNameMap: buildWireToolNameMap(input.tools.map((tool) => tool.name)),
      options: input.options,
      signal: input.signal
    });
  }

  async *resumeTurn(input: ProviderResumeInput): AsyncIterable<ProviderEvent> {
    input.signal.throwIfAborted();
    const state = input.continuationState;
    if (!isGeminiContinuationState(state)) {
      throw new GatewayError("INVALID_CONTINUATION_STATE", "Missing or invalid Gemini continuation state");
    }

    // Los resultados de tool vuelven como un content `user` con parts functionResponse,
    // correlacionados por NOMBRE de función (Gemini no usa call id en el cable).
    // LIMITACIÓN de la correlación por nombre: si el modelo pide DOS calls de la MISMA función
    // en paralelo, el nombre es ambiguo; se resuelve por ORDEN (FIFO): el resultado de cada
    // resume se atribuye a la llamada despachada en ese momento (pendingToolName) y las
    // respuestas se acumulan en el orden del cable (que es el orden de despacho).
    const collected: GeminiFunctionResponsePart[] = [
      ...(state.collectedResponses ?? []),
      ...input.toolResults.map((result) => toFunctionResponsePart(result, state.pendingToolName))
    ];

    const pending = state.pendingCalls ?? [];
    const nextCall = pending[0];
    if (nextCall) {
      // Quedan functionCalls paralelas sin resultado: se despacha la SIGUIENTE al navegador
      // SIN llamar al proveedor (Gemini espera todos los functionResponse juntos en el mismo
      // turno user; volver antes dejaría el cable inválido).
      const continuationState: GeminiContinuationState = {
        ...state,
        pendingToolName: nextCall.name,
        pendingCalls: pending.slice(1),
        collectedResponses: collected
      };
      yield {
        type: "tool_call.ready",
        continuationState,
        call: {
          // callId interno (Gemini no lo provee): correlación nuestra; el cable usa el nombre.
          callId: createId("call"),
          // El navegador ejecuta por el nombre ORIGINAL (con punto); el cable lleva el saneado.
          name: state.toolNameMap?.[nextCall.name] ?? nextCall.name,
          arguments: nextCall.args
        }
      };
      return;
    }

    // Todos los functionCalls del turno model tienen respuesta: un solo content `user` con los
    // functionResponse en el ORDEN del cable.
    const responseContent: GeminiContent = {
      role: "user",
      parts: collected
    };
    yield* this.runGenerate({
      model: input.model,
      credential: input.credential,
      systemInstruction: state.systemInstruction,
      contents: [...state.contents, responseContent],
      tools: state.tools,
      toolNameMap: state.toolNameMap ?? {},
      options: state.options,
      signal: input.signal
    });
  }

  private authHeaders(credential: ProviderCredentialLease): Record<string, string> {
    // La API key arrendada va SOLO aquí (header x-goog-api-key, no query param); nunca se loguea.
    return { "x-goog-api-key": credential.secret };
  }

  private async *runGenerate(params: {
    model: ModelDescriptor;
    credential: ProviderCredentialLease;
    systemInstruction: { parts: GeminiTextPart[] } | null;
    contents: GeminiContent[];
    tools: GeminiTool[];
    toolNameMap: Record<string, string>;
    options: GenerationOptions;
    signal: AbortSignal;
  }): AsyncGenerator<ProviderEvent> {
    const compat = params.model.capabilities.compat;
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: params.options.maxOutputTokens
    };
    if (params.options.temperature !== undefined) {
      generationConfig.temperature = params.options.temperature;
    }
    // Razonamiento -> thinkingConfig.thinkingBudget (tokens). Knob SEPARADO de maxOutputTokens.
    // Se envía solo si el modelo soporta thinking y el mapeo da un budget; si no, se OMITE.
    const budget =
      compat.supportsReasoningEffort && params.options.reasoningEffort
        ? GEMINI_THINKING_BUDGETS[params.options.reasoningEffort]
        : null;
    if (budget) {
      generationConfig.thinkingConfig = { thinkingBudget: budget, includeThoughts: true };
    }

    const body: Record<string, unknown> = {
      contents: params.contents,
      generationConfig
    };
    if (params.systemInstruction) {
      body.systemInstruction = params.systemInstruction;
    }
    if (params.tools.length > 0) {
      body.tools = params.tools;
      body.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
    }

    const modelPath = stripModelsPrefix(params.model.route.providerModelId);
    const url = `${this.baseUrl}/models/${modelPath}:streamGenerateContent?alt=sse`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.authHeaders(params.credential) },
      body: JSON.stringify(body),
      signal: params.signal
    });
    if (!response.ok) {
      throw new GatewayError(
        "PROVIDER_REQUEST_FAILED",
        `Gemini generateContent request failed with status ${response.status}`
      );
    }
    if (!response.body) {
      throw new GatewayError("PROVIDER_REQUEST_FAILED", "Gemini generateContent returned no body");
    }

    let usage: TurnUsage = emptyTurnUsage();
    let assistantText = "";
    const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

    for await (const data of readServerSentEvents(response.body)) {
      let chunk: GeminiStreamChunk;
      try {
        chunk = JSON.parse(data) as GeminiStreamChunk;
      } catch {
        continue;
      }
      if (chunk.error) {
        throw new GatewayError(
          "PROVIDER_REQUEST_FAILED",
          chunk.error.message ?? "Gemini generateContent stream reported an error"
        );
      }
      if (chunk.usageMetadata) {
        usage = mapUsage(chunk.usageMetadata);
      }
      const parts = chunk.candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts)) {
        continue;
      }
      for (const part of parts) {
        if (isFunctionCallPart(part)) {
          const fc = part.functionCall;
          toolCalls.push({ name: fc.name, args: fc.args ?? {} });
        } else if (isTextPart(part)) {
          if (part.thought) {
            // Resumen de "thinking" (includeThoughts): se emite como reasoning, no como texto.
            if (part.text.length > 0) {
              yield { type: "reasoning.summary", summary: part.text };
            }
          } else {
            assistantText += part.text;
            if (part.text.length > 0) {
              yield { type: "text.delta", delta: part.text };
            }
          }
        }
      }
    }

    const first = toolCalls[0];
    if (first) {
      // Content `model` VERBATIM para la continuación: TODOS los functionCalls del turno
      // (Gemini exige un functionResponse por cada uno en el siguiente turno user). El texto
      // previo se conserva si lo hubo. El navegador ejecuta una tool a la vez: se emite la
      // PRIMERA y las RESTANTES quedan pendientes en el estado de continuación; resumeTurn
      // las drena una a una antes de volver al proveedor.
      const continuationParts: GeminiPart[] = [];
      if (assistantText.length > 0) {
        continuationParts.push({ text: assistantText });
      }
      for (const call of toolCalls) {
        continuationParts.push({ functionCall: { name: call.name, args: call.args } });
      }
      const continuationState: GeminiContinuationState = {
        protocol: "gemini_generate_content",
        systemInstruction: params.systemInstruction,
        contents: [...params.contents, { role: "model", parts: continuationParts }],
        tools: params.tools,
        options: params.options,
        // El pendiente conserva el nombre DE CABLE (saneado) que emitió el proveedor: el
        // functionResponse del resume debe correlacionar con ese nombre exacto.
        pendingToolName: first.name,
        pendingCalls: toolCalls.slice(1).map((call) => ({ name: call.name, args: call.args })),
        collectedResponses: [],
        toolNameMap: params.toolNameMap
      };
      // El navegador ejecuta por el nombre ORIGINAL (con punto); Gemini vio/emitió el saneado.
      yield {
        type: "tool_call.ready",
        continuationState,
        // callId interno (Gemini no lo provee): correlación nuestra; el cable usa el nombre.
        call: {
          callId: createId("call"),
          name: params.toolNameMap[first.name] ?? first.name,
          arguments: first.args
        }
      };
      return;
    }

    yield { type: "completed", usage };
  }
}

/**
 * Construye un ModelDescriptor Gemini. El /v1beta/models SÍ trae inputTokenLimit/outputTokenLimit
 * (se usan como ventana de contexto y cap de salida); el soporte de thinking se resuelve por el
 * mapa documentado por familia. Lo desconocido queda null/unknown (jamás un stub inventado).
 */
export function createGeminiModel(input: {
  baseUrl: string;
  modelId: string;
  row?: GeminiModelRow;
}): ModelDescriptor {
  const row = input.row;
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const modelId = stripModelsPrefix(input.modelId);
  const supportsThinking = GEMINI_THINKING_RE.test(modelId);
  // Los modelos Gemini son multimodales (entrada de imagen documentada).
  const inputModalities = new Set<"text" | "image" | "audio" | "video" | "file">(["text", "image"]);

  return {
    id: `${GEMINI_PROVIDER_ID}/${modelId}`,
    label: row?.displayName ?? modelId,
    route: {
      providerId: GEMINI_PROVIDER_ID,
      providerModelId: modelId,
      protocol: "gemini_generate_content",
      endpointBaseUrl: baseUrl
    },
    capabilities: {
      streaming: "supported",
      inputModalities,
      outputModalities: new Set(["text"]),
      toolCalling: {
        // Gemini soporta function calling (documentado).
        support: "supported",
        strictSchema: "unknown",
        parallelCalls: "supported"
      },
      structuredOutput: {
        // Gemini soporta responseMimeType/responseSchema, pero este adaptador no lo expone aún.
        jsonObject: "unknown",
        jsonSchema: "unknown",
        strictSchema: "unknown"
      },
      reasoning: {
        support: supportsThinking ? "supported" : "unknown",
        allowedEfforts: supportsThinking ? ["low", "medium", "high"] : [],
        summaryOutput: supportsThinking ? "supported" : "unknown"
      },
      promptCaching: { read: "unknown", write: "unknown" },
      tokenCounting: { exact: "unsupported", estimated: "supported" },
      contextWindowTokens: row?.inputTokenLimit ?? null,
      effectiveContextTokens: null,
      maxOutputTokens: row?.outputTokenLimit ?? null,
      compat: {
        supportsTools: true,
        supportsReasoningEffort: supportsThinking,
        thinkingFormat: supportsThinking ? "gemini_thinking" : "none",
        supportsStrictMode: false,
        supportsUsageInStreaming: true,
        supportsEagerToolInputStreaming: false
      }
    },
    source: row ? "discovered" : "curated",
    deprecatedAt: null
  };
}

// --- Helpers de mapeo. -------------------------------------------------------------

/** Quita el prefijo "models/" del id (Gemini lo antepone en /v1beta/models). */
function stripModelsPrefix(id: string): string {
  return id.startsWith("models/") ? id.slice("models/".length) : id;
}

/**
 * Separa los mensajes canónicos en `systemInstruction` (concatena todos los mensajes `system`:
 * capa SEGURIDAD + PERSONA + MEMORIA) y la lista `contents` (user/model). Los roles `tool`
 * (defensivo) se degradan a `user`.
 */
function toGeminiContents(messages: CanonicalMessage[]): {
  systemInstruction: { parts: GeminiTextPart[] } | null;
  contents: GeminiContent[];
} {
  const systemParts: string[] = [];
  const contents: GeminiContent[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      const text = message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
      if (text.length > 0) {
        systemParts.push(text);
      }
      continue;
    }
    const role: "user" | "model" = message.role === "assistant" ? "model" : "user";
    contents.push({ role, parts: message.content.map((part) => toPart(part)) });
  }
  const systemInstruction =
    systemParts.length > 0 ? { parts: [{ text: systemParts.join("\n\n") }] } : null;
  return { systemInstruction, contents };
}

function toPart(part: CanonicalMessage["content"][number]): GeminiPart {
  if (part.type === "text") {
    return { text: part.text };
  }
  return { inlineData: { mimeType: part.mimeType, data: part.data } };
}

// El cable lleva el nombre SANEADO (Gemini no admite el punto de nuestros namespaces; ver
// kernel/tool-names.ts); la reversión al original usa el toolNameMap de la continuación.
function toGeminiTools(tools: ModelToolDefinition[]): GeminiTool[] {
  if (tools.length === 0) {
    return [];
  }
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: sanitizeWireToolName(tool.name),
        description: tool.description,
        parameters: tool.inputSchema
      }))
    }
  ];
}

function toFunctionResponsePart(result: ToolCallResult, name: string): GeminiFunctionResponsePart {
  if (result.result.status === "success") {
    const content = result.result.content;
    // functionResponse.response debe ser un objeto (struct); se envuelve lo que no lo sea.
    const response =
      content !== null && typeof content === "object" && !Array.isArray(content)
        ? (content as Record<string, unknown>)
        : { result: content };
    return { functionResponse: { name, response } };
  }
  return {
    functionResponse: {
      name,
      response: { error: { code: result.result.code, message: result.result.message } }
    }
  };
}

function mapUsage(usage: GeminiUsageMetadata): TurnUsage {
  return {
    inputTokens: usage.promptTokenCount ?? null,
    outputTokens: usage.candidatesTokenCount ?? null,
    cachedInputTokens: usage.cachedContentTokenCount ?? null,
    // Gemini no separa creación de caché en su usageMetadata.
    cacheWriteTokens: null
  };
}

/**
 * Parser SSE incremental sobre el ReadableStream (Gemini con alt=sse emite `data:` por chunk).
 * Emite el payload de cada línea `data:` (sin el prefijo); no interpreta el JSON.
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
