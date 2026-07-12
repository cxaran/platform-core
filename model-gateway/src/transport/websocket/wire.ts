import type { GatewaySettings } from "../../config/settings.js";
import type { ModelDescriptor, ProviderProtocol } from "../../domain/model.js";

/**
 * Forma de cable (snake_case) de un modelo del catálogo para la RPC models.list.
 * Convierte los Set de modalidades a arrays serializables y expone las capacidades
 * enriquecidas (B5): contexto nativo vs efectivo + flags compat. NO incluye credenciales.
 */
export interface WireModel {
  id: string;
  label: string;
  provider_id: string;
  provider_model_id: string;
  protocol: ProviderProtocol;
  source: ModelDescriptor["source"];
  deprecated_at: string | null;
  // Precios por token (P7) si se conocen; null = precio desconocido. snake_case por token.
  pricing: {
    currency: string;
    prompt_per_token: number | null;
    completion_per_token: number | null;
    cache_read_per_token: number | null;
    cache_write_per_token: number | null;
  } | null;
  capabilities: {
    streaming: string;
    input_modalities: string[];
    output_modalities: string[];
    tool_calling: ModelDescriptor["capabilities"]["toolCalling"];
    structured_output: ModelDescriptor["capabilities"]["structuredOutput"];
    reasoning: {
      support: string;
      allowed_efforts: readonly string[];
      summary_output: string;
    };
    prompt_caching: ModelDescriptor["capabilities"]["promptCaching"];
    token_counting: ModelDescriptor["capabilities"]["tokenCounting"];
    context_window_tokens: number | null;
    effective_context_tokens: number | null;
    max_output_tokens: number | null;
    compat: ModelDescriptor["capabilities"]["compat"];
  };
}

export function toWireModel(model: ModelDescriptor): WireModel {
  const capabilities = model.capabilities;
  return {
    id: model.id,
    label: model.label,
    provider_id: model.route.providerId,
    provider_model_id: model.route.providerModelId,
    protocol: model.route.protocol,
    source: model.source,
    deprecated_at: model.deprecatedAt,
    pricing: model.pricing
      ? {
          currency: model.pricing.currency,
          prompt_per_token: model.pricing.promptPerToken,
          completion_per_token: model.pricing.completionPerToken,
          cache_read_per_token: model.pricing.cacheReadPerToken,
          cache_write_per_token: model.pricing.cacheWritePerToken
        }
      : null,
    capabilities: {
      streaming: capabilities.streaming,
      input_modalities: [...capabilities.inputModalities],
      output_modalities: [...capabilities.outputModalities],
      tool_calling: capabilities.toolCalling,
      structured_output: capabilities.structuredOutput,
      reasoning: {
        support: capabilities.reasoning.support,
        allowed_efforts: capabilities.reasoning.allowedEfforts,
        summary_output: capabilities.reasoning.summaryOutput
      },
      prompt_caching: capabilities.promptCaching,
      token_counting: capabilities.tokenCounting,
      context_window_tokens: capabilities.contextWindowTokens,
      effective_context_tokens: capabilities.effectiveContextTokens,
      max_output_tokens: capabilities.maxOutputTokens,
      compat: capabilities.compat
    }
  };
}

export interface WireProviderStatus {
  protocol: ProviderProtocol;
  registered: true;
  available: boolean;
}

/**
 * Estado gateway-side de los proveedores registrados. `available` refleja si el gateway
 * tiene la configuración necesaria (p.ej. base URL de opencode); NO consulta credenciales
 * del usuario (eso lo hace el frontend contra FastAPI).
 */
export function describeProviderStatus(
  protocols: ProviderProtocol[],
  settings: GatewaySettings
): WireProviderStatus[] {
  return protocols.map((protocol) => ({
    protocol,
    registered: true,
    available: isProtocolAvailable(protocol, settings)
  }));
}

function isProtocolAvailable(protocol: ProviderProtocol, settings: GatewaySettings): boolean {
  if (protocol === "opencode_zen") {
    return Boolean(settings.opencodeBaseUrl);
  }
  // El resto de protocolos solo se registra cuando su config existe (bootstrap/container:
  // cada proveedor real es opt-in con base URL, y el fake se registra en modo dev o con
  // GATEWAY_FAKE_ENABLED), así que registrado => disponible.
  return true;
}
