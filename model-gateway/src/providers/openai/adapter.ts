import { GatewayError } from "../../kernel/errors.js";
import { createId } from "../../kernel/ids.js";
import { buildWireToolNameMap, sanitizeWireToolName } from "../../kernel/tool-names.js";
import { emptyTurnUsage } from "../../domain/usage.js";
import { nativeReasoningEffort } from "../../domain/reasoning.js";
import {
  runOpenAICompatChat,
  toOpenAICompatMessages,
  toOpenAICompatTools,
  advanceOpenAICompatContinuation,
  toolResultContent,
  safeParseJson,
  readServerSentEvents,
  isOpenAICompatChatContinuation,
  type OpenAICompatChatContinuation
} from "../openai-compat/chat.js";
import type { GenerationOptions } from "../../application/capabilities/capability-negotiator.js";
import type { CanonicalMessage } from "../../domain/message.js";
import type { ModelDescriptor, ProviderProtocol } from "../../domain/model.js";
import type { ModelToolDefinition } from "../../domain/tool.js";
import type { TurnUsage } from "../../domain/usage.js";
import type {
  ProviderAdapter,
  ProviderCredentialLease,
  ProviderEvent,
  ProviderResumeInput,
  ProviderTurnInput
} from "../../ports/provider-adapter.port.js";

/**
 * Adaptador de proveedor OpenAI / Codex (P6, paridad OpenClaw Codex provider). Un solo
 * provider id ``openai`` cubre DOS "auth shapes" (patrón OpenClaw: la auth elige el
 * transporte para el mismo provider): API key directa o suscripción ChatGPT Plus vía OAuth
 * (Codex). El puente de arriendo (B4/B10) ya resuelve ambos casos y entrega un Bearer (la
 * API key descifrada o el access token OAuth refrescado), así que el adaptador SIEMPRE
 * autentica con ``Authorization: Bearer <secret>`` y nunca ve ni almacena la credencial.
 *
 * Dos FAMILIAS de cable, seleccionadas por ``apiFlavor``:
 *  - ``chat_completions``: OpenAI estándar (/chat/completions + /models). Reusa el NÚCLEO
 *    OpenAI-compatible compartido (providers/openai-compat/chat.ts), igual que OpenRouter.
 *  - ``codex_responses``: app-server Responses de Codex (/responses) para los turnos de
 *    AGENTE de la suscripción ChatGPT Plus (modela el runtime nativo Codex de OpenClaw).
 *
 * Relay de tools (el navegador ejecuta; el gateway NUNCA toca tools del negocio), streaming
 * acumulado a snapshot, y resolución de capacidades HONESTA (lo desconocido es null/unknown,
 * jamás stub en el camino real). Aislamiento por usuario: el lease es transitorio.
 */

export const OPENAI_PROVIDER_ID = "openai";
// Codex/suscripción ChatGPT vive bajo un provider id PROPIO ("openai_codex") para arrendar
// la credencial OAuth (vs la API key de "openai") y poder ofrecer AMBOS a la vez.
export const OPENAI_CODEX_PROVIDER_ID = "openai_codex";
export type OpenAIProviderId = "openai" | "openai_codex";
export type OpenAIApiFlavor = "chat_completions" | "codex_responses";

// Originator por defecto del flujo Codex (debe coincidir con el del backend FastAPI que
// genera el authorize). El backend de ChatGPT correlaciona el header con el cliente OAuth.
const DEFAULT_CODEX_ORIGINATOR = "codex_cli_rs";
// El discovery de Codex filtra modelos por versión del cliente; un valor alto devuelve el
// catálogo completo que la cuenta puede usar. Configurable por si el gating cambia.
const DEFAULT_CODEX_CLIENT_VERSION = "1.0.0";
// El backend de ChatGPT puede exigir ``instructions`` no vacío (400 "Instructions are not
// valid." si falta). En turnos reales llega el system prompt del agente; este es el fallback.
const DEFAULT_CODEX_INSTRUCTIONS = "Eres un asistente. Toda salida es un borrador que el usuario revisa y aprueba.";

export interface OpenAIProviderOptions {
  baseUrl: string;
  // Familia de cable. Default: chat_completions (OpenAI API key). Para ChatGPT Plus/Codex
  // (OAuth) se usa codex_responses contra el base URL del backend de ChatGPT.
  apiFlavor?: OpenAIApiFlavor;
  // Solo flavor codex_responses: identifica el cliente Codex suplantado en el header
  // ``originator``. Default ``codex_cli_rs``.
  originator?: string;
  // Solo flavor codex_responses: el discovery /models exige ``client_version`` (gating por
  // versión del cliente). Default ``1.0.0`` (alto, para recibir el catálogo completo).
  codexClientVersion?: string;
  // Provider id con el que se registra/arrienda: "openai" (API key) u "openai_codex"
  // (suscripción). Determina la clave del registry y el route.providerId de los modelos.
  providerId?: OpenAIProviderId;
  fetchImpl?: typeof fetch;
}

// Ventanas de contexto DOCUMENTADAS públicamente por familia de modelo OpenAI (prefijo).
// Solo se usan cuando el proveedor NO expone metadatos (caso Codex/Responses). No es un
// stub: son valores publicados; lo que no esté aquí queda como null (desconocido honesto).
const OPENAI_DOCUMENTED_CONTEXT: ReadonlyArray<readonly [RegExp, number]> = [
  [/^gpt-5/, 400000],
  [/^gpt-4\.1/, 1047576],
  [/^gpt-4o/, 128000],
  [/^o[134](-|$)/, 200000]
];

// Familias de modelos OpenAI que razonan (documentado): serie o* y gpt-5. El resto, unknown.
const OPENAI_REASONING_RE = /^(o[134](-|$)|gpt-5)/;

function documentedContextWindow(modelId: string): number | null {
  for (const [re, window] of OPENAI_DOCUMENTED_CONTEXT) {
    if (re.test(modelId)) {
      return window;
    }
  }
  return null;
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

// Fila del discovery de Codex (/models?client_version=…). Solo los campos que mapeamos.
interface CodexModelRow {
  slug: string;
  context_window?: number;
  max_context_window?: number;
  input_modalities?: string[];
  supports_parallel_tool_calls?: boolean;
  supports_reasoning_summaries?: boolean;
}

// --- Tipos de cable Responses (Codex app-server; parcial). -------------------------

type ResponsesContentPart =
  | { type: "input_text"; text: string }
  | { type: "output_text"; text: string }
  | { type: "input_image"; image_url: string };

type ResponsesInputItem =
  | { type: "message"; role: "system" | "user" | "assistant"; content: ResponsesContentPart[] }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

interface ResponsesTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface ResponsesUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
}

// Evento SSE del Responses API: lleva un `type` discriminante.
interface ResponsesStreamEvent {
  type: string;
  delta?: string;
  item?: { type?: string; call_id?: string; id?: string; name?: string; arguments?: string };
  response?: { usage?: ResponsesUsage | null };
}

// --- Estado de continuación (por flavor). ------------------------------------------
// El flavor chat_completions usa el estado de continuación del núcleo compartido (marcado con
// protocol "openai"); el flavor codex_responses tiene el suyo propio.

interface CodexContinuationState {
  protocol: "openai";
  flavor: "codex_responses";
  input: ResponsesInputItem[];
  tools: ResponsesTool[];
  options: GenerationOptions;
  // El prompt de sistema va en el campo top-level `instructions` (no como item de input) en el
  // backend de ChatGPT; se conserva para reemitirlo idéntico en la reanudación.
  instructions: string | null;
  // Correlación de la sesión Codex; estable a lo largo del turno (start + resumes).
  sessionId: string;
  // Mapa nombre_saneado → nombre_original de tools. El Responses de Codex exige nombres
  // ^[a-zA-Z0-9_-]+$ (sin punto), pero el navegador ejecuta por el nombre original.
  nameMap: Record<string, string>;
}

type OpenAIContinuationState = OpenAICompatChatContinuation | CodexContinuationState;

function isOpenAIContinuationState(state: unknown): state is OpenAIContinuationState {
  const c = state as OpenAIContinuationState | null;
  return Boolean(
    c &&
      c.protocol === "openai" &&
      (c.flavor === "chat_completions" || c.flavor === "codex_responses")
  );
}

export class OpenAIProviderAdapter implements ProviderAdapter {
  // Clave del registry = provider id ("openai" u "openai_codex"). El "wire" sigue siendo la
  // familia OpenAI (route.protocol = "openai"); este campo solo distingue qué credencial se
  // arrienda y bajo qué id se ofrecen los modelos.
  readonly protocol: ProviderProtocol;
  private readonly providerId: OpenAIProviderId;
  private readonly baseUrl: string;
  private readonly apiFlavor: OpenAIApiFlavor;
  private readonly originator: string;
  private readonly codexClientVersion: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAIProviderOptions) {
    this.providerId = options.providerId ?? "openai";
    this.protocol = this.providerId;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiFlavor = options.apiFlavor ?? "chat_completions";
    this.originator = options.originator ?? DEFAULT_CODEX_ORIGINATOR;
    this.codexClientVersion = options.codexClientVersion ?? DEFAULT_CODEX_CLIENT_VERSION;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Discovery EN VIVO para la suscripción ChatGPT: GET /models?client_version=… devuelve
   * ``{models:[{slug, context_window, input_modalities, …}]}`` con los modelos REALES que la
   * cuenta puede usar (varían por plan). Best-effort: si falla, [] y se conserva lo curado.
   */
  private async discoverCodexModels(credential: ProviderCredentialLease): Promise<ModelDescriptor[]> {
    const url = `${this.baseUrl}/models?client_version=${encodeURIComponent(this.codexClientVersion)}`;
    const response = await this.fetchImpl(url, { method: "GET", headers: this.codexBaseHeaders(credential) });
    if (!response.ok) {
      return [];
    }
    const payload = (await response.json()) as { models?: CodexModelRow[] } | null;
    const rows = Array.isArray(payload?.models) ? payload.models : [];
    return rows
      .filter((row) => typeof row.slug === "string" && row.slug.length > 0)
      .map((row) => createCodexModel({ baseUrl: this.baseUrl, row, providerId: this.providerId }));
  }

  async discoverModels(credential: ProviderCredentialLease): Promise<ModelDescriptor[]> {
    // Codex/suscripción ChatGPT: el listado vive en /models?client_version=… (NO el /models
    // estándar de OpenAI) y devuelve {models:[{slug, context_window, …}]} con metadatos ricos.
    if (this.apiFlavor === "codex_responses") {
      return this.discoverCodexModels(credential);
    }
    const response = await this.fetchImpl(`${this.baseUrl}/models`, {
      method: "GET",
      headers: this.authHeaders(credential)
    });
    if (!response.ok) {
      throw new GatewayError(
        "PROVIDER_DISCOVERY_FAILED",
        `OpenAI model discovery failed with status ${response.status}`
      );
    }
    const payload = (await response.json()) as { data?: OpenAIModelRow[] } | null;
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows.map((row) =>
      createOpenAIModel({
        baseUrl: this.baseUrl,
        modelId: row.id,
        row,
        apiFlavor: this.apiFlavor,
        providerId: this.providerId
      })
    );
  }

  async *startTurn(input: ProviderTurnInput): AsyncIterable<ProviderEvent> {
    input.signal.throwIfAborted();
    if (this.apiFlavor === "codex_responses") {
      const { instructions, input: items } = splitResponsesInput(input.messages);
      yield* this.runCodexResponses({
        model: input.model,
        credential: input.credential,
        instructions,
        input: items,
        tools: toResponsesTools(input.tools),
        nameMap: buildCodexToolNameMap(input.tools),
        options: input.options,
        sessionId: createId("sess"),
        signal: input.signal
      });
      return;
    }
    yield* runOpenAICompatChat({
      baseUrl: this.baseUrl,
      fetchImpl: this.fetchImpl,
      providerLabel: "OpenAI",
      continuationProtocol: "openai",
      authHeaders: this.authHeaders(input.credential),
      model: input.model,
      messages: toOpenAICompatMessages(input.messages),
      tools: toOpenAICompatTools(input.tools),
      options: input.options,
      bodyExtensions: chatReasoningBody(input.model, input.options),
      signal: input.signal
    });
  }

  async *resumeTurn(input: ProviderResumeInput): AsyncIterable<ProviderEvent> {
    input.signal.throwIfAborted();
    const state = input.continuationState;
    if (!isOpenAIContinuationState(state)) {
      throw new GatewayError("INVALID_CONTINUATION_STATE", "Missing or invalid OpenAI continuation state");
    }

    if (state.flavor === "codex_responses") {
      const outputs: ResponsesInputItem[] = input.toolResults.map((result) => ({
        type: "function_call_output",
        call_id: result.callId,
        output: toolResultContent(result)
      }));
      yield* this.runCodexResponses({
        model: input.model,
        credential: input.credential,
        instructions: state.instructions,
        input: [...state.input, ...outputs],
        tools: state.tools,
        nameMap: state.nameMap,
        options: state.options,
        sessionId: state.sessionId,
        signal: input.signal
      });
      return;
    }

    // Flavor chat_completions: el estado de continuación es el del núcleo compartido.
    if (!isOpenAICompatChatContinuation(state, "openai")) {
      throw new GatewayError("INVALID_CONTINUATION_STATE", "Missing or invalid OpenAI chat continuation state");
    }
    // Si el assistant pidió tools en paralelo, se despacha la siguiente al navegador sin llamar
    // al proveedor (el cable exige un mensaje tool por cada tool_call_id antes de reanudar).
    const advance = advanceOpenAICompatContinuation(state, input.toolResults);
    if (advance.nextEvent) {
      yield advance.nextEvent;
      return;
    }
    yield* runOpenAICompatChat({
      baseUrl: this.baseUrl,
      fetchImpl: this.fetchImpl,
      providerLabel: "OpenAI",
      continuationProtocol: "openai",
      authHeaders: this.authHeaders(input.credential),
      model: input.model,
      messages: advance.messages,
      tools: state.tools,
      options: state.options,
      bodyExtensions: chatReasoningBody(input.model, state.options),
      signal: input.signal
    });
  }

  private authHeaders(credential: ProviderCredentialLease): Record<string, string> {
    // El Bearer arrendado (API key o access token OAuth) va SOLO aquí; nunca se loguea.
    return { authorization: `Bearer ${credential.secret}` };
  }

  /**
   * Headers base del backend de ChatGPT (auth + cuenta + originator + OpenAI-Beta). Comunes a
   * GET /models y POST /responses. ``chatgpt-account-id`` solo si el lease trae la cuenta OAuth.
   */
  private codexBaseHeaders(credential: ProviderCredentialLease): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.authHeaders(credential),
      originator: this.originator,
      "OpenAI-Beta": "responses=experimental"
    };
    if (credential.accountId) {
      headers["chatgpt-account-id"] = credential.accountId;
    }
    return headers;
  }

  /** Headers para POST /responses: base + content-type + session_id del turno. */
  private codexHeaders(credential: ProviderCredentialLease, sessionId: string): Record<string, string> {
    return { "content-type": "application/json", ...this.codexBaseHeaders(credential), session_id: sessionId };
  }

  // --- Responses (Codex app-server / suscripción ChatGPT Plus). --------------------

  private async *runCodexResponses(params: {
    model: ModelDescriptor;
    credential: ProviderCredentialLease;
    instructions: string | null;
    input: ResponsesInputItem[];
    tools: ResponsesTool[];
    nameMap: Record<string, string>;
    options: GenerationOptions;
    sessionId: string;
    signal: AbortSignal;
  }): AsyncGenerator<ProviderEvent> {
    const compat = params.model.capabilities.compat;
    const body: Record<string, unknown> = {
      model: params.model.route.providerModelId,
      input: params.input,
      stream: true,
      // El backend de ChatGPT exige modo SIN estado (no persiste la conversación server-side).
      // NO acepta ``max_output_tokens`` (responde 400 "Unsupported parameter"); se omite.
      store: false
    };
    // Prompt de sistema como `instructions` top-level (forma del backend de ChatGPT), no como
    // item de input. Obligatorio y no vacío: si el turno no trae sistema, va el fallback.
    body.instructions = params.instructions ?? DEFAULT_CODEX_INSTRUCTIONS;
    if (params.tools.length > 0) {
      body.tools = params.tools;
      body.tool_choice = "auto";
    }
    // Codex Responses: el razonamiento va en `reasoning.effort` (nivel nativo). "max"->"high";
    // off o modelo sin soporte => se OMITE.
    const reasoningEffort =
      compat.supportsReasoningEffort
        ? nativeReasoningEffort(params.model.route.protocol, params.options.reasoningEffort)
        : null;
    if (reasoningEffort) {
      body.reasoning = { effort: reasoningEffort };
    }

    const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: this.codexHeaders(params.credential, params.sessionId),
      body: JSON.stringify(body),
      signal: params.signal
    });
    if (!response.ok) {
      throw new GatewayError(
        "PROVIDER_REQUEST_FAILED",
        `Codex responses request failed with status ${response.status}`
      );
    }
    if (!response.body) {
      throw new GatewayError("PROVIDER_REQUEST_FAILED", "Codex responses returned no body");
    }

    let usage: TurnUsage = emptyTurnUsage();
    let assistantText = "";
    const toolCalls: { callId: string; name: string; args: string }[] = [];
    // `response.completed` es el evento TERMINAL del Responses API. El backend de ChatGPT/Codex
    // normalmente NO envía `data: [DONE]` y puede mantener la conexión abierta (keep-alive) tras
    // completarse; sin este corte explícito, el `for await` se quedaría bloqueado esperando datos
    // que no llegan y el turno nunca emitiría `completed` (síntoma: el cliente se queda "Pensando…").
    let streamCompleted = false;

    for await (const data of readServerSentEvents(response.body)) {
      if (data === "[DONE]") {
        break;
      }
      let event: ResponsesStreamEvent;
      try {
        event = JSON.parse(data) as ResponsesStreamEvent;
      } catch {
        continue;
      }

      switch (event.type) {
        case "response.output_text.delta": {
          if (typeof event.delta === "string" && event.delta.length > 0) {
            assistantText += event.delta;
            yield { type: "text.delta", delta: event.delta };
          }
          break;
        }
        case "response.reasoning_summary_text.delta": {
          if (typeof event.delta === "string" && event.delta.length > 0) {
            yield { type: "reasoning.summary", summary: event.delta };
          }
          break;
        }
        case "response.output_item.done": {
          const item = event.item;
          if (item?.type === "function_call" && typeof item.name === "string") {
            toolCalls.push({
              callId: item.call_id || item.id || createId("call"),
              name: item.name,
              args: item.arguments ?? ""
            });
          }
          break;
        }
        case "response.completed": {
          if (event.response?.usage) {
            usage = mapResponsesUsage(event.response.usage);
          }
          streamCompleted = true;
          break;
        }
        case "response.failed":
        case "error": {
          throw new GatewayError("PROVIDER_REQUEST_FAILED", "Codex responses stream reported an error");
        }
        default:
          break;
      }

      // El `break` del switch no rompe el for-await; al ver el evento terminal salimos del bucle
      // para no quedar bloqueados esperando un `[DONE]` que el backend de ChatGPT no envía.
      if (streamCompleted) {
        break;
      }
    }

    const first = toolCalls[0];
    if (first) {
      const assistantItems: ResponsesInputItem[] = [];
      if (assistantText.length > 0) {
        assistantItems.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: assistantText }]
        });
      }
      // El item function_call debe quedar en el input para que el function_call_output case.
      assistantItems.push({
        type: "function_call",
        call_id: first.callId,
        name: first.name,
        arguments: first.args
      });
      const continuationState: CodexContinuationState = {
        protocol: "openai",
        flavor: "codex_responses",
        input: [...params.input, ...assistantItems],
        tools: params.tools,
        options: params.options,
        instructions: params.instructions,
        sessionId: params.sessionId,
        nameMap: params.nameMap
      };
      yield {
        type: "tool_call.ready",
        continuationState,
        // El navegador ejecuta por el nombre ORIGINAL (con punto); Codex usó el saneado.
        call: {
          callId: first.callId,
          name: params.nameMap[first.name] ?? first.name,
          arguments: safeParseJson(first.args)
        }
      };
      return;
    }

    yield { type: "completed", usage };
  }
}

/**
 * Razonamiento para el flavor chat_completions: nivel normalizado -> `reasoning_effort` nativo.
 * Solo se envía si el modelo soporta el control y el mapeo da un valor; si no, se OMITE.
 */
function chatReasoningBody(model: ModelDescriptor, options: GenerationOptions): Record<string, unknown> | undefined {
  const compat = model.capabilities.compat;
  const reasoningEffort = compat.supportsReasoningEffort
    ? nativeReasoningEffort(model.route.protocol, options.reasoningEffort)
    : null;
  return reasoningEffort ? { reasoning_effort: reasoningEffort } : undefined;
}

/**
 * Construye un ModelDescriptor OpenAI/Codex. Si llega una fila de /models con metadatos, se
 * usan; donde el proveedor no expone nada (caso Codex), se cae a las VENTANAS DOCUMENTADAS
 * por familia y a las familias de razonamiento documentadas; lo desconocido queda null/unknown
 * (jamás un stub inventado).
 */
export function createOpenAIModel(input: {
  baseUrl: string;
  modelId: string;
  row?: OpenAIModelRow;
  apiFlavor?: OpenAIApiFlavor;
  providerId?: OpenAIProviderId;
}): ModelDescriptor {
  const providerId = input.providerId ?? OPENAI_PROVIDER_ID;
  const row = input.row;
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const supportsTools = row?.supports_tools ?? true;
  const supportsReasoning = row?.supports_reasoning ?? OPENAI_REASONING_RE.test(input.modelId);
  const hasVision = row?.modalities ? row.modalities.includes("image") : false;
  const inputModalities = new Set<"text" | "image" | "audio" | "video" | "file">(["text"]);
  if (hasVision) {
    inputModalities.add("image");
  }
  // Ventana: metadato del proveedor si lo hay; si no, ventana documentada por familia; si no,
  // null (desconocido honesto → el budgeter usará el cap global del gateway).
  const contextWindow =
    row?.context_length ?? row?.context_window ?? documentedContextWindow(input.modelId);
  const maxOutput = row?.max_output_tokens ?? row?.max_tokens ?? null;

  return {
    id: `${providerId}/${input.modelId}`,
    label: row?.name ?? input.modelId,
    route: {
      providerId,
      providerModelId: input.modelId,
      // protocol = providerId: es la CLAVE del registry con que StartTurn/ResumeTurn resuelven
      // el adaptador. "openai" y "openai_codex" comparten familia de razonamiento (reasoning.ts).
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
        supportsUsageInStreaming: input.apiFlavor !== "codex_responses",
        supportsEagerToolInputStreaming: true
      }
    },
    source: row ? "discovered" : "curated",
    deprecatedAt: null
  };
}

/**
 * Construye un ModelDescriptor desde una fila del discovery de Codex (/models?client_version=…).
 * Mapea SOLO lo que el proveedor reporta; lo no informado queda null/unknown (sin inventar).
 */
export function createCodexModel(input: {
  baseUrl: string;
  row: CodexModelRow;
  providerId?: OpenAIProviderId;
}): ModelDescriptor {
  const providerId = input.providerId ?? OPENAI_CODEX_PROVIDER_ID;
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const row = input.row;
  const inputModalities = new Set<"text" | "image" | "audio" | "video" | "file">(["text"]);
  if (Array.isArray(row.input_modalities) && row.input_modalities.includes("image")) {
    inputModalities.add("image");
  }
  const contextWindow = row.context_window ?? row.max_context_window ?? null;

  return {
    id: `${providerId}/${row.slug}`,
    label: row.slug,
    route: {
      providerId,
      providerModelId: row.slug,
      // protocol = providerId: clave del registry (StartTurn/ResumeTurn). Ver createOpenAIModel.
      protocol: providerId,
      endpointBaseUrl: baseUrl
    },
    capabilities: {
      streaming: "supported",
      inputModalities,
      outputModalities: new Set(["text"]),
      toolCalling: {
        support: "supported",
        strictSchema: "unknown",
        parallelCalls: row.supports_parallel_tool_calls ? "supported" : "unknown"
      },
      structuredOutput: { jsonObject: "supported", jsonSchema: "unknown", strictSchema: "unknown" },
      reasoning: {
        // Los modelos de Codex razonan; el resumen se reporta vía supports_reasoning_summaries.
        support: "supported",
        allowedEfforts: ["low", "medium", "high"],
        summaryOutput: row.supports_reasoning_summaries ? "supported" : "unknown"
      },
      promptCaching: { read: "unknown", write: "unknown" },
      tokenCounting: { exact: "unsupported", estimated: "supported" },
      contextWindowTokens: contextWindow,
      effectiveContextTokens: null,
      // El backend de ChatGPT rechaza max_output_tokens; no hay tope declarado.
      maxOutputTokens: null,
      compat: {
        supportsTools: true,
        supportsReasoningEffort: true,
        thinkingFormat: "openai_reasoning_effort",
        supportsStrictMode: false,
        // Codex/Responses no emite usage incremental fiable en el stream.
        supportsUsageInStreaming: false,
        supportsEagerToolInputStreaming: true
      }
    },
    source: "discovered",
    deprecatedAt: null
  };
}

// --- Helpers de mapeo del flavor Responses (Codex). --------------------------------

/**
 * Separa los mensajes para el backend de ChatGPT: el texto de los mensajes de sistema va al
 * campo top-level ``instructions``; el resto se mapea como items de ``input``. Si no hay
 * sistema, ``instructions`` es null y se omite.
 */
function splitResponsesInput(
  messages: CanonicalMessage[]
): { instructions: string | null; input: ResponsesInputItem[] } {
  const systemTexts: string[] = [];
  const rest: CanonicalMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      for (const part of message.content) {
        if (part.type === "text") {
          systemTexts.push(part.text);
        }
      }
    } else {
      rest.push(message);
    }
  }
  return {
    instructions: systemTexts.length > 0 ? systemTexts.join("\n\n") : null,
    input: toResponsesInput(rest)
  };
}

function toResponsesInput(messages: CanonicalMessage[]): ResponsesInputItem[] {
  return messages.map((message) => {
    const role = message.role === "tool" ? "user" : message.role;
    const content: ResponsesContentPart[] = message.content.map((part) => {
      if (part.type === "text") {
        // El rol assistant usa output_text; el resto, input_text (forma del Responses API).
        return role === "assistant"
          ? { type: "output_text", text: part.text }
          : { type: "input_text", text: part.text };
      }
      return { type: "input_image", image_url: `data:${part.mimeType};base64,${part.data}` };
    });
    return { type: "message", role, content };
  });
}

// El Responses de Codex exige nombres de function ^[a-zA-Z0-9_-]{1,64}$ (NO admite el punto
// de nuestros namespaces, p. ej. "example.search_patients"). Criterio canónico compartido en
// kernel/tool-names.ts (saneo + truncado a 64); el mapa inverso recupera el nombre original
// para ejecutar la tool en el navegador.
function sanitizeCodexToolName(name: string): string {
  return sanitizeWireToolName(name);
}

function buildCodexToolNameMap(tools: ModelToolDefinition[]): Record<string, string> {
  return buildWireToolNameMap(tools.map((tool) => tool.name));
}

function toResponsesTools(tools: ModelToolDefinition[]): ResponsesTool[] {
  return tools.map((tool) => ({
    type: "function",
    name: sanitizeCodexToolName(tool.name),
    description: tool.description,
    parameters: tool.inputSchema
  }));
}

function mapResponsesUsage(usage: ResponsesUsage): TurnUsage {
  return {
    inputTokens: usage.input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? null,
    cacheWriteTokens: null
  };
}
