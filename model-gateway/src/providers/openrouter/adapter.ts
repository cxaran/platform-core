import { GatewayError } from "../../kernel/errors.js";
import { nativeReasoningEffort } from "../../domain/reasoning.js";
import {
  runOpenAICompatChat,
  toOpenAICompatMessages,
  toOpenAICompatTools,
  advanceOpenAICompatContinuation,
  isOpenAICompatChatContinuation
} from "../openai-compat/chat.js";
import type { GenerationOptions } from "../../application/capabilities/capability-negotiator.js";
import type { ModelDescriptor, ModelPricing } from "../../domain/model.js";
import type {
  ProviderAdapter,
  ProviderCredentialLease,
  ProviderEvent,
  ProviderResumeInput,
  ProviderTurnInput
} from "../../ports/provider-adapter.port.js";

/**
 * Adaptador de proveedor OpenRouter (paridad OpenClaw openrouter provider). OpenRouter es
 * OpenAI-COMPATIBLE (/chat/completions + /models), así que la forma de cable se reusa del
 * NÚCLEO compartido (providers/openai-compat/chat.ts) — el mismo que usa el flavor
 * chat_completions de OpenAI. El VALOR DE PARIDAD aquí es el DISCOVERY RICO: su /models
 * devuelve muchos modelos CON metadatos reales de capacidad (context_length,
 * supported_parameters, architecture.input_modalities, top_provider.max_completion_tokens),
 * que CONSUMIMOS para poblar nuestras capacidades —sin mapa curado ni adivinanzas—. Honesto:
 * si un campo falta, la capacidad queda unknown/false; jamás se inventa.
 *
 * Relay de tools CLIENT-EJECUTA (el navegador ejecuta; el gateway NUNCA toca tools del negocio).
 * Auth: Bearer la key arrendada (B3, cifrada por usuario); nunca se loguea. Aislamiento por
 * usuario: el lease es transitorio.
 */

export const OPENROUTER_PROVIDER_ID = "openrouter";
// Marcador del estado de continuación (para validar el resume del adaptador dueño).
const OPENROUTER_CONTINUATION = "openrouter";

export interface OpenRouterProviderOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

interface OpenRouterModelRow {
  id: string;
  name?: string;
  created?: number;
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number | null;
  };
  supported_parameters?: string[];
  // Precios por token (strings USD) que OpenRouter publica en su /models (P7).
  pricing?: {
    prompt?: string;
    completion?: string;
    request?: string;
    input_cache_read?: string;
    input_cache_write?: string;
  };
}

export class OpenRouterProviderAdapter implements ProviderAdapter {
  // OpenRouter habla chat/completions; usa el protocolo OpenAI-compatible (distinto de "openai",
  // que es el adaptador OpenAI/Codex) para tener su propia entrada en el registry.
  readonly protocol = "openai_chat_completions" as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenRouterProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async discoverModels(credential: ProviderCredentialLease): Promise<ModelDescriptor[]> {
    // /models trae metadatos REALES: se consumen tal cual (sin mapa curado).
    const response = await this.fetchImpl(`${this.baseUrl}/models`, {
      method: "GET",
      headers: this.authHeaders(credential)
    });
    if (!response.ok) {
      throw new GatewayError(
        "PROVIDER_DISCOVERY_FAILED",
        `OpenRouter model discovery failed with status ${response.status}`
      );
    }
    const payload = (await response.json()) as { data?: OpenRouterModelRow[] } | null;
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows.map((row) => createOpenRouterModel({ baseUrl: this.baseUrl, modelId: row.id, row }));
  }

  async *startTurn(input: ProviderTurnInput): AsyncIterable<ProviderEvent> {
    input.signal.throwIfAborted();
    yield* runOpenAICompatChat({
      baseUrl: this.baseUrl,
      fetchImpl: this.fetchImpl,
      providerLabel: "OpenRouter",
      continuationProtocol: OPENROUTER_CONTINUATION,
      authHeaders: this.authHeaders(input.credential),
      model: input.model,
      messages: toOpenAICompatMessages(input.messages),
      tools: toOpenAICompatTools(input.tools),
      options: input.options,
      bodyExtensions: reasoningBody(input.model, input.options),
      signal: input.signal
    });
  }

  async *resumeTurn(input: ProviderResumeInput): AsyncIterable<ProviderEvent> {
    input.signal.throwIfAborted();
    const state = input.continuationState;
    if (!isOpenAICompatChatContinuation(state, OPENROUTER_CONTINUATION)) {
      throw new GatewayError("INVALID_CONTINUATION_STATE", "Missing or invalid OpenRouter continuation state");
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
      providerLabel: "OpenRouter",
      continuationProtocol: OPENROUTER_CONTINUATION,
      authHeaders: this.authHeaders(input.credential),
      model: input.model,
      messages: advance.messages,
      tools: state.tools,
      options: state.options,
      bodyExtensions: reasoningBody(input.model, state.options),
      signal: input.signal
    });
  }

  private authHeaders(credential: ProviderCredentialLease): Record<string, string> {
    // La key arrendada va SOLO aquí (Bearer); nunca se loguea.
    return { authorization: `Bearer ${credential.secret}` };
  }
}

/**
 * Mapea el bloque de precios de OpenRouter (strings USD por token) a ModelPricing. Valores
 * ausentes o no numéricos quedan en null (precio desconocido honesto). Si no hay bloque de
 * precios, devuelve null.
 */
function toPricing(pricing: OpenRouterModelRow["pricing"]): ModelPricing | null {
  if (!pricing) {
    return null;
  }
  const parse = (value: string | undefined): number | null => {
    if (value === undefined) {
      return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  return {
    currency: "USD",
    promptPerToken: parse(pricing.prompt),
    completionPerToken: parse(pricing.completion),
    cacheReadPerToken: parse(pricing.input_cache_read),
    cacheWritePerToken: parse(pricing.input_cache_write)
  };
}

/**
 * Razonamiento de OpenRouter: parámetro UNIFICADO `reasoning: { effort }` (distinto al
 * `reasoning_effort` plano de OpenAI). Nivel normalizado -> effort nativo; se envía solo si el
 * modelo lo soporta (supported_parameters) y el mapeo da un valor; si no, se OMITE.
 */
function reasoningBody(model: ModelDescriptor, options: GenerationOptions): Record<string, unknown> | undefined {
  const compat = model.capabilities.compat;
  const effort = compat.supportsReasoningEffort
    ? nativeReasoningEffort(model.route.protocol, options.reasoningEffort)
    : null;
  return effort ? { reasoning: { effort } } : undefined;
}

/**
 * Construye un ModelDescriptor OpenRouter CONSUMIENDO los metadatos reales de /models. Cada
 * capacidad sale de un campo del proveedor; si el campo falta, la capacidad queda unknown/false
 * (jamás se inventa). Éste es el punto distintivo frente a opencode (cuyo /models es pobre y
 * necesita un mapa curado).
 */
export function createOpenRouterModel(input: {
  baseUrl: string;
  modelId: string;
  row?: OpenRouterModelRow;
}): ModelDescriptor {
  const row = input.row;
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const params = row?.supported_parameters;
  const hasParams = Array.isArray(params);
  const toolsParam = hasParams ? params.includes("tools") || params.includes("tool_choice") : false;
  const reasoningParam = hasParams ? params.includes("reasoning") || params.includes("include_reasoning") : false;

  const inputModalitiesRaw = row?.architecture?.input_modalities;
  const hasVision = Array.isArray(inputModalitiesRaw) ? inputModalitiesRaw.includes("image") : false;
  const inputModalities = new Set<"text" | "image" | "audio" | "video" | "file">(["text"]);
  if (hasVision) {
    inputModalities.add("image");
  }

  const contextWindow = row?.context_length ?? row?.top_provider?.context_length ?? null;
  const maxOutput = row?.top_provider?.max_completion_tokens ?? null;

  return {
    pricing: toPricing(row?.pricing),
    id: `${OPENROUTER_PROVIDER_ID}/${input.modelId}`,
    label: row?.name ?? input.modelId,
    route: {
      providerId: OPENROUTER_PROVIDER_ID,
      // El id vendor/model se envía VERBATIM como body.model en /chat/completions.
      providerModelId: input.modelId,
      protocol: "openai_chat_completions",
      endpointBaseUrl: baseUrl
    },
    capabilities: {
      streaming: "supported",
      inputModalities,
      outputModalities: new Set(["text"]),
      toolCalling: {
        // Honesto: con supported_parameters presente, el flag decide; sin él, unknown.
        support: !hasParams ? "unknown" : toolsParam ? "supported" : "unsupported",
        strictSchema: "unknown",
        parallelCalls: "unknown"
      },
      structuredOutput: {
        jsonObject: "unknown",
        jsonSchema: "unknown",
        strictSchema: "unknown"
      },
      reasoning: {
        support: !hasParams ? "unknown" : reasoningParam ? "supported" : "unsupported",
        allowedEfforts: reasoningParam ? ["low", "medium", "high"] : [],
        summaryOutput: "unknown"
      },
      promptCaching: { read: "unknown", write: "unknown" },
      tokenCounting: { exact: "unsupported", estimated: "supported" },
      contextWindowTokens: contextWindow,
      effectiveContextTokens: null,
      maxOutputTokens: maxOutput,
      compat: {
        supportsTools: toolsParam,
        supportsReasoningEffort: reasoningParam,
        thinkingFormat: reasoningParam ? "openai_reasoning_effort" : "none",
        supportsStrictMode: false,
        supportsUsageInStreaming: true,
        supportsEagerToolInputStreaming: true
      }
    },
    source: row ? "discovered" : "curated",
    deprecatedAt: null
  };
}
