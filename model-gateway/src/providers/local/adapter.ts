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
import type { ModelDescriptor } from "../../domain/model.js";
import type {
  ProviderAdapter,
  ProviderCredentialLease,
  ProviderEvent,
  ProviderResumeInput,
  ProviderTurnInput
} from "../../ports/provider-adapter.port.js";

/**
 * Adaptador de runtime de inferencia LOCAL / on-prem (Ollama / vLLM). Importa:
 * inferencia dentro del la organizaciÃ³n donde NINGÚN proveedor en la nube ve datos del registro
 * (la datos sensibles nunca sale de la de la organización). Tanto Ollama como vLLM exponen endpoints chat
 * OpenAI-COMPATIBLE, así que se REUSA el núcleo compartido (providers/openai-compat/chat.ts),
 * el mismo de OpenAI/OpenRouter — sin duplicar la maquinaria de cable.
 *
 * Un solo adaptador apunta a un base URL local configurable (GATEWAY_LOCAL_BASE_URL; por
 * defecto el de Ollama, http://localhost:11434/v1). vLLM funciona apuntando ese mismo ajuste
 * a su /v1.
 *
 * DIFERENCIA CLAVE vs los adaptadores en la nube: el runtime local suele NO requerir API key.
 * El arriendo puede devolver una credencial VACÍA/ausente: en ese caso NO se envía header
 * Authorization (y aun así funciona). Si SÍ hay key (algunos despliegues de vLLM la exigen),
 * se manda como Bearer. Nunca se falla por credencial vacía.
 *
 * HONESTIDAD de capacidades: los modelos locales rara vez exponen metadatos ricos; muchos
 * tienen soporte de tools débil o nulo. Se marca lo desconocido como unknown y supportsTools
 * como false por defecto (no se reclaman tools que el modelo no puede hacer). El relay
 * client-ejecuta es el mismo del flavor chat. Aislamiento por usuario: el lease es transitorio.
 */

export const LOCAL_PROVIDER_ID = "ollama";
const LOCAL_CONTINUATION = "ollama";

export interface LocalProviderOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

interface LocalModelRow {
  id: string;
  created?: number;
  owned_by?: string;
  // Algunos despliegues de vLLM incluyen el largo de contexto del modelo.
  max_model_len?: number;
  context_length?: number;
}

export class LocalProviderAdapter implements ProviderAdapter {
  readonly protocol = "ollama_chat" as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LocalProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async discoverModels(credential: ProviderCredentialLease): Promise<ModelDescriptor[]> {
    // Endpoint OpenAI-compatible. Los modelos locales rara vez traen metadatos de capacidad,
    // así que createLocalModel cae a defaults HONESTOS (unknown) más lo que el endpoint dé.
    const response = await this.fetchImpl(`${this.baseUrl}/models`, {
      method: "GET",
      headers: this.authHeaders(credential)
    });
    if (!response.ok) {
      throw new GatewayError(
        "PROVIDER_DISCOVERY_FAILED",
        `Local model discovery failed with status ${response.status}`
      );
    }
    const payload = (await response.json()) as { data?: LocalModelRow[] } | null;
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows.map((row) => createLocalModel({ baseUrl: this.baseUrl, modelId: row.id, row }));
  }

  async *startTurn(input: ProviderTurnInput): AsyncIterable<ProviderEvent> {
    input.signal.throwIfAborted();
    yield* runOpenAICompatChat({
      baseUrl: this.baseUrl,
      fetchImpl: this.fetchImpl,
      providerLabel: "Local",
      continuationProtocol: LOCAL_CONTINUATION,
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
    if (!isOpenAICompatChatContinuation(state, LOCAL_CONTINUATION)) {
      throw new GatewayError("INVALID_CONTINUATION_STATE", "Missing or invalid local continuation state");
    }
    // Si el assistant pidió tools en paralelo, se despacha la siguiente al navegador sin llamar
    // al proveedor (el cable exige un mensaje tool por cada tool_call_id antes de reanudar).
    // Mismo drenado del núcleo compartido que usan OpenAI y OpenRouter.
    const advance = advanceOpenAICompatContinuation(state, input.toolResults);
    if (advance.nextEvent) {
      yield advance.nextEvent;
      return;
    }
    yield* runOpenAICompatChat({
      baseUrl: this.baseUrl,
      fetchImpl: this.fetchImpl,
      providerLabel: "Local",
      continuationProtocol: LOCAL_CONTINUATION,
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
    // SIN key (credencial vacía/ausente) => NO se envía Authorization (el runtime local no la
    // requiere). Con key (p. ej. vLLM con --api-key) => Bearer. Nunca se loguea la key.
    const secret = credential.secret?.trim();
    return secret ? { authorization: `Bearer ${secret}` } : {};
  }
}

/**
 * Razonamiento para el runtime local OpenAI-compatible: nivel normalizado -> reasoning_effort.
 * Solo se envía si el modelo REPORTA soporte de reasoning (por defecto el local no lo reporta,
 * así que se OMITE). No se reclama una capacidad que no se conoce.
 */
function reasoningBody(model: ModelDescriptor, options: GenerationOptions): Record<string, unknown> | undefined {
  const compat = model.capabilities.compat;
  const effort = compat.supportsReasoningEffort
    ? nativeReasoningEffort(model.route.protocol, options.reasoningEffort)
    : null;
  return effort ? { reasoning_effort: effort } : undefined;
}

/**
 * Construye un ModelDescriptor para un modelo local con defaults HONESTOS. El endpoint local
 * rara vez expone capacidades, así que: ventana de contexto = lo que dé el endpoint
 * (max_model_len de vLLM si está) o null; tools/reasoning/visión quedan UNKNOWN/false (muchos
 * modelos locales no soportan tools — no se reclama lo que no se sabe). Jamás un stub inventado.
 */
export function createLocalModel(input: {
  baseUrl: string;
  modelId: string;
  row?: LocalModelRow;
}): ModelDescriptor {
  const row = input.row;
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const contextWindow = row?.max_model_len ?? row?.context_length ?? null;

  return {
    id: `${LOCAL_PROVIDER_ID}/${input.modelId}`,
    label: input.modelId,
    route: {
      providerId: LOCAL_PROVIDER_ID,
      // El id local se envía VERBATIM como body.model (p. ej. "llama3.1:8b", "qwen2.5:7b").
      providerModelId: input.modelId,
      protocol: "ollama_chat",
      endpointBaseUrl: baseUrl
    },
    capabilities: {
      streaming: "supported",
      // Sin metadatos de modalidad: se asume solo texto (no se reclama visión).
      inputModalities: new Set(["text"]),
      outputModalities: new Set(["text"]),
      toolCalling: {
        // HONESTO: el endpoint no dice si soporta tools y muchos locales no lo hacen -> unknown.
        support: "unknown",
        strictSchema: "unknown",
        parallelCalls: "unknown"
      },
      structuredOutput: {
        jsonObject: "unknown",
        jsonSchema: "unknown",
        strictSchema: "unknown"
      },
      reasoning: {
        support: "unknown",
        allowedEfforts: [],
        summaryOutput: "unknown"
      },
      promptCaching: { read: "unknown", write: "unknown" },
      tokenCounting: { exact: "unsupported", estimated: "supported" },
      contextWindowTokens: contextWindow,
      effectiveContextTokens: null,
      maxOutputTokens: null,
      compat: {
        // Conservador y honesto: no se reclaman tools ni reasoning que el modelo no anuncia.
        supportsTools: false,
        supportsReasoningEffort: false,
        thinkingFormat: "none",
        supportsStrictMode: false,
        // El soporte de usage en streaming varía entre Ollama/vLLM: conservador en false.
        supportsUsageInStreaming: false,
        supportsEagerToolInputStreaming: false
      }
    },
    source: row ? "discovered" : "curated",
    deprecatedAt: null
  };
}
