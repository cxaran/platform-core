export type ProviderId = string;
export type ModelId = string;

export type ProviderProtocol =
  | "openai_chat_completions"
  | "anthropic_messages"
  | "gemini_generate_content"
  | "ollama_chat"
  // B5: opencode zen es OpenAI-compatible (chat completions + /models, Bearer auth).
  | "opencode_zen"
  // OpenCode Go: misma API OpenAI-compatible que Zen pero otro base URL y catalogo
  // (suscripcion); se enruta con su propio provider id para arrendar la credencial correcta.
  | "opencode_go"
  // OpenAI API key: provider id "openai", familia chat/completions contra api.openai.com.
  | "openai"
  // Codex/suscripcion ChatGPT: provider id PROPIO para arrendar la credencial OAuth (no la
  // API key) y poder ofrecer ambos a la vez. Wire = app-server Responses contra chatgpt.com.
  | "openai_codex"
  | "fake";

// Formato de "thinking"/razonamiento que entiende el proveedor en el cable (patrón
// OpenClaw): cada familia expone el control de razonamiento de forma distinta.
export type ThinkingFormat =
  | "none"
  | "openai_reasoning_effort"
  | "anthropic_thinking"
  | "gemini_thinking";

// Flags finos de compatibilidad (patrón OpenClaw ModelCatalogCompatConfig). Son
// PISTAS DE FORMA DE CABLE que consumen los adaptadores de proveedor para construir
// la request; la negociación granular (toolCalling/structuredOutput/reasoning) sigue
// siendo la autoridad para aceptar/rechazar.
export interface ModelCompatFlags {
  supportsTools: boolean;
  supportsReasoningEffort: boolean;
  thinkingFormat: ThinkingFormat;
  // Structured/strict output (response_format json_schema con strict).
  supportsStrictMode: boolean;
  // Usage incluido dentro del stream (OpenAI stream_options.include_usage).
  supportsUsageInStreaming: boolean;
  // Streaming temprano de argumentos de tool (deltas de tool_call.function.arguments).
  supportsEagerToolInputStreaming: boolean;
}

export type CapabilitySupport = "supported" | "unsupported" | "unknown";

export type InputModality = "text" | "image" | "audio" | "video" | "file";
export type OutputModality = "text" | "image" | "audio" | "json";
export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export interface ModelCapabilities {
  streaming: CapabilitySupport;
  inputModalities: ReadonlySet<InputModality>;
  outputModalities: ReadonlySet<OutputModality>;
  toolCalling: {
    support: CapabilitySupport;
    strictSchema: CapabilitySupport;
    parallelCalls: CapabilitySupport;
  };
  structuredOutput: {
    jsonObject: CapabilitySupport;
    jsonSchema: CapabilitySupport;
    strictSchema: CapabilitySupport;
  };
  reasoning: {
    support: CapabilitySupport;
    allowedEfforts: readonly ReasoningEffort[];
    summaryOutput: CapabilitySupport;
  };
  promptCaching: {
    read: CapabilitySupport;
    write: CapabilitySupport;
  };
  tokenCounting: {
    exact: CapabilitySupport;
    estimated: CapabilitySupport;
  };
  // Ventana de contexto NATIVA del modelo (lo que anuncia el proveedor).
  contextWindowTokens: number | null;
  // Cap EFECTIVO en runtime (más bajo que el nativo si la cuenta/plan lo limita); se
  // mantiene separado del nativo para que el context budgeter pueda usar el menor. Seam B5:
  // HOY ningún adaptador lo puebla (siempre null), así que aún no acota nada en la práctica.
  effectiveContextTokens: number | null;
  maxOutputTokens: number | null;
  // Flags finos de compatibilidad consumidos por los adaptadores de proveedor.
  compat: ModelCompatFlags;
}

export interface ModelRoute {
  providerId: ProviderId;
  providerModelId: ModelId;
  protocol: ProviderProtocol;
  endpointBaseUrl: string;
}

// Precio por TOKEN por categoría (P7, tracking de costo). Provider-neutral: cuando el proveedor
// publica precios (p. ej. OpenRouter en su /models) se mapean aquí; cuando no se conocen, queda
// null (precio desconocido honesto — jamás un número inventado). La divisa la fija el proveedor.
export interface ModelPricing {
  currency: string;
  promptPerToken: number | null;
  completionPerToken: number | null;
  cacheReadPerToken: number | null;
  cacheWritePerToken: number | null;
}

// Provenance del enriquecimiento de un descriptor cuando se combina el discovery del proveedor
// con un mapa CURADO (opencode /models trae filas mínimas; ver providers/opencode/catalog). Deja
// trazable qué valores son del proveedor vs curados, para que la historia de honestidad (y el
// indicador de costo P7) sea inspeccionable. "provider" = lo reportó el proveedor; "curated" =
// relleno del mapa curado; "mixed" = proveedor + relleno curado; "none" = ni uno ni otro
// (defaults/desconocido).
export interface ModelEnrichment {
  capabilities: "provider" | "curated" | "mixed" | "none";
  pricing: "provider" | "curated" | "none";
}

export interface ModelDescriptor {
  id: `${ProviderId}/${ModelId}`;
  label: string;
  route: ModelRoute;
  capabilities: ModelCapabilities;
  source: "curated" | "discovered" | "manual";
  deprecatedAt: string | null;
  // Precios por token si se conocen (P7). Opcional: la mayoría de proveedores no los publican.
  pricing?: ModelPricing | null;
  // Provenance del enriquecimiento (discovery vs curado). Opcional: sólo lo fijan los adaptadores
  // que combinan ambas fuentes (hoy opencode).
  enrichment?: ModelEnrichment;
}

export function createFakeModel(overrides: Partial<ModelDescriptor> = {}): ModelDescriptor {
  const base: ModelDescriptor = {
    id: "fake/fake-model",
    label: "Fake Model",
    route: {
      providerId: "fake",
      providerModelId: "fake-model",
      protocol: "fake",
      endpointBaseUrl: "memory://fake"
    },
    capabilities: {
      streaming: "supported",
      inputModalities: new Set(["text"]),
      outputModalities: new Set(["text"]),
      toolCalling: {
        support: "supported",
        strictSchema: "supported",
        parallelCalls: "unsupported"
      },
      structuredOutput: {
        jsonObject: "supported",
        jsonSchema: "supported",
        strictSchema: "supported"
      },
      reasoning: {
        support: "unsupported",
        allowedEfforts: [],
        summaryOutput: "unsupported"
      },
      promptCaching: {
        read: "unsupported",
        write: "unsupported"
      },
      tokenCounting: {
        exact: "unsupported",
        estimated: "supported"
      },
      contextWindowTokens: 128000,
      effectiveContextTokens: null,
      maxOutputTokens: 4096,
      compat: {
        supportsTools: true,
        supportsReasoningEffort: false,
        thinkingFormat: "none",
        supportsStrictMode: true,
        supportsUsageInStreaming: true,
        supportsEagerToolInputStreaming: false
      }
    },
    source: "manual",
    deprecatedAt: null
  };

  return { ...base, ...overrides };
}
