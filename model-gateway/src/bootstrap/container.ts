import { loadSettings } from "../config/settings.js";
import { FakeControlPlaneClient } from "../infrastructure/control-plane/fake-control-plane.client.js";
import { HttpControlPlaneClient } from "../infrastructure/control-plane/http-control-plane.client.js";
import { InMemoryModelCatalog } from "../infrastructure/catalog/in-memory-model-catalog.js";
import { InMemoryTurnStore } from "../infrastructure/turn-store/in-memory-turn-store.js";
import { NoopRateLimiter } from "../infrastructure/rate-limit/noop-rate-limiter.js";
import { PinoTelemetry } from "../infrastructure/observability/pino-telemetry.js";
import { FakeProviderAdapter } from "../providers/fake/adapter.js";
import {
  OpencodeProviderAdapter,
  createOpencodeModel,
  OPENCODE_GO_PROVIDER_ID
} from "../providers/opencode/adapter.js";
import { OpenAIProviderAdapter, createOpenAIModel } from "../providers/openai/adapter.js";
import { AnthropicProviderAdapter, createAnthropicModel } from "../providers/anthropic/adapter.js";
import { GeminiProviderAdapter, createGeminiModel } from "../providers/gemini/adapter.js";
import { OpenRouterProviderAdapter, createOpenRouterModel } from "../providers/openrouter/adapter.js";
import { LocalProviderAdapter, createLocalModel } from "../providers/local/adapter.js";
import { ProviderRegistry } from "../providers/registry.js";
import { createFakeModel } from "../domain/model.js";
import { InMemoryBrowserSessionStore } from "../application/browser-sessions/session-store.js";
import { ModelDiscoveryService } from "../application/capabilities/model-discovery.js";
import { HttpBackendSessionValidator } from "../infrastructure/backend-session/http-backend-session.validator.js";
import type { GatewaySettings } from "../config/settings.js";
import type { BackendSessionValidatorPort } from "../ports/backend-session.port.js";
import type { ControlPlanePort } from "../ports/control-plane.port.js";
import type { ProviderAdapter } from "../ports/provider-adapter.port.js";
import type { ModelCatalogPort } from "../ports/model-catalog.port.js";
import type { ProviderRegistryPort } from "../ports/provider-registry.port.js";
import type { RateLimiterPort } from "../ports/rate-limiter.port.js";
import type { TelemetryPort } from "../ports/telemetry.port.js";
import type { TurnStorePort } from "../ports/turn-store.port.js";

export interface GatewayContainer {
  settings: GatewaySettings;
  controlPlane: ControlPlanePort;
  // Validador de la sesión del backend para cada turno. ``null`` en dev/tests (sin backend
  // real): la validación queda DESACTIVADA, igual que el control-plane real. Cuando hay
  // backend configurado, ningún turno corre sin una sesión del backend viva.
  backendSession: BackendSessionValidatorPort | null;
  modelCatalog: ModelCatalogPort;
  modelDiscovery: ModelDiscoveryService;
  providerRegistry: ProviderRegistryPort;
  turnStore: TurnStorePort;
  limiter: RateLimiterPort;
  telemetry: TelemetryPort;
  browserSessions: InMemoryBrowserSessionStore;
}

export function createContainer(settings = loadSettings()): GatewayContainer {
  const browserSessions = new InMemoryBrowserSessionStore();

  // ¿Hay backend real configurado? Decide el control-plane (real vs fake) y, por invariante,
  // si el proveedor fake debe registrarse (ver abajo).
  const hasRealControlPlane = Boolean(settings.backendInternalUrl && settings.backendInternalSecret);

  // B5: primer proveedor real. opencode es el catálogo base; el registry expone su protocolo.
  const opencodeAdapter = new OpencodeProviderAdapter({ baseUrl: settings.opencodeBaseUrl });
  const opencodeModel = createOpencodeModel({
    baseUrl: settings.opencodeBaseUrl,
    modelId: settings.opencodeDefaultModel
  });

  const adapters: ProviderAdapter[] = [opencodeAdapter];
  const catalogModels = [opencodeModel];

  // Proveedor FAKE (dev/tests). INVARIANTE: el control-plane fake (modo dev sin backend) solo
  // sabe autorizar el proveedor "fake"; sin el adaptador+modelo fake registrados, ese modo
  // fallaría en turn.start con PROVIDER_PROTOCOL_NOT_REGISTERED. Por eso se registra siempre
  // que el control-plane resuelto sea el fake, además del override explícito
  // GATEWAY_FAKE_ENABLED (caso backend-real + fake para pruebas). Con backend real y sin el
  // flag, el fake NO figura como proveedor ni modelo.
  if (settings.fakeEnabled || !hasRealControlPlane) {
    adapters.unshift(new FakeProviderAdapter());
    catalogModels.unshift(createFakeModel());
  }

  // OpenCode Go (opt-in): mismo adaptador OpenAI-compatible, otro base URL y provider id
  // (opencode_go) para que el arriendo busque la credencial Go correcta. La misma key
  // opencode sirve, pero contra el endpoint Go.
  if (settings.opencodeGoEnabled && settings.opencodeGoBaseUrl) {
    const opencodeGoAdapter = new OpencodeProviderAdapter({
      baseUrl: settings.opencodeGoBaseUrl,
      providerId: OPENCODE_GO_PROVIDER_ID
    });
    const opencodeGoModel = createOpencodeModel({
      baseUrl: settings.opencodeGoBaseUrl,
      modelId: settings.opencodeGoDefaultModel ?? "qwen3.7-plus",
      providerId: OPENCODE_GO_PROVIDER_ID
    });
    adapters.push(opencodeGoAdapter);
    catalogModels.push(opencodeGoModel);
  }

  // OpenAI API key (P6, opt-in). Provider id "openai", chat_completions contra api.openai.com.
  // El discovery /models lista en vivo; el modelo por defecto es fila curada de fallback.
  if (settings.openaiEnabled && settings.openaiBaseUrl) {
    const openaiAdapter = new OpenAIProviderAdapter({
      baseUrl: settings.openaiBaseUrl,
      apiFlavor: "chat_completions",
      providerId: "openai"
    });
    const openaiModel = createOpenAIModel({
      baseUrl: settings.openaiBaseUrl,
      modelId: settings.openaiDefaultModel ?? "gpt-4o-mini",
      apiFlavor: "chat_completions",
      providerId: "openai"
    });
    adapters.push(openaiAdapter);
    catalogModels.push(openaiModel);
  }

  // Codex / suscripción ChatGPT (opt-in, INDEPENDIENTE de la API key). Provider id propio
  // "openai_codex" para arrendar la credencial OAuth (vs la API key de "openai") → ambos
  // coexisten. Discovery en vivo vía /models?client_version=…; el default es fila curada.
  if (settings.openaiCodexEnabled && settings.openaiCodexBaseUrl) {
    const codexAdapter = new OpenAIProviderAdapter({
      baseUrl: settings.openaiCodexBaseUrl,
      apiFlavor: "codex_responses",
      providerId: "openai_codex",
      codexClientVersion: settings.openaiCodexClientVersion ?? "1.0.0"
    });
    const codexModel = createOpenAIModel({
      baseUrl: settings.openaiCodexBaseUrl,
      modelId: settings.openaiCodexDefaultModel ?? "gpt-5.5",
      apiFlavor: "codex_responses",
      providerId: "openai_codex"
    });
    adapters.push(codexAdapter);
    catalogModels.push(codexModel);
  }

  // Anthropic (opt-in). FAMILIA DE CABLE distinta (Messages API): demuestra que el gateway
  // maneja un segundo protocolo, no solo OpenAI-compatible. La key llega por arriendo (B3/B4);
  // el modelo por defecto se registra curado y el discovery añade los reales de /v1/models.
  if (settings.anthropicEnabled && settings.anthropicBaseUrl) {
    const anthropicAdapter = new AnthropicProviderAdapter({ baseUrl: settings.anthropicBaseUrl });
    const anthropicModel = createAnthropicModel({
      baseUrl: settings.anthropicBaseUrl,
      modelId: settings.anthropicDefaultModel ?? "claude-sonnet-4-5"
    });
    adapters.push(anthropicAdapter);
    catalogModels.push(anthropicModel);
  }

  // Google Gemini (opt-in). TERCERA familia de cable (Generative Language API): refuerza la
  // neutralidad de proveedor del gateway. La key llega por arriendo (B3/B4); el modelo por
  // defecto se registra curado y el discovery añade los reales de /v1beta/models.
  if (settings.geminiEnabled && settings.geminiBaseUrl) {
    const geminiAdapter = new GeminiProviderAdapter({ baseUrl: settings.geminiBaseUrl });
    const geminiModel = createGeminiModel({
      baseUrl: settings.geminiBaseUrl,
      modelId: settings.geminiDefaultModel ?? "gemini-2.5-flash"
    });
    adapters.push(geminiAdapter);
    catalogModels.push(geminiModel);
  }

  // OpenRouter (opt-in). OpenAI-compatible con DISCOVERY RICO: el modelo por defecto se registra
  // curado (caps unknown hasta el discovery) y el discovery de /models trae los reales con
  // metadatos de capacidad. La key llega por arriendo (B3/B4).
  if (settings.openrouterEnabled && settings.openrouterBaseUrl) {
    const openrouterAdapter = new OpenRouterProviderAdapter({ baseUrl: settings.openrouterBaseUrl });
    const openrouterModel = createOpenRouterModel({
      baseUrl: settings.openrouterBaseUrl,
      modelId: settings.openrouterDefaultModel ?? "openai/gpt-4o-mini"
    });
    adapters.push(openrouterAdapter);
    catalogModels.push(openrouterModel);
  }

  // Runtime LOCAL / on-prem (Ollama / vLLM), opt-in. Inferencia en la de la organización: la datos sensibles nunca
  // sale a la nube. OpenAI-compatible (reusa el núcleo); suele no requerir API key. El modelo
  // por defecto se registra curado (caps honestas unknown) y el discovery añade lo que el
  // endpoint local exponga.
  if (settings.localEnabled && settings.localBaseUrl) {
    const localAdapter = new LocalProviderAdapter({ baseUrl: settings.localBaseUrl });
    const localModel = createLocalModel({
      baseUrl: settings.localBaseUrl,
      modelId: settings.localDefaultModel ?? "llama3.1:8b"
    });
    adapters.push(localAdapter);
    catalogModels.push(localModel);
  }

  const modelCatalog = new InMemoryModelCatalog(catalogModels);

  // B4: si hay config del backend interno, se usa el control-plane real que arrienda
  // credenciales contra FastAPI; si no, el fake (dev/tests). authorizeTurn parsea el
  // profileId (providerId/modelId); el modelo real lo resuelve el discovery.
  const controlPlane: ControlPlanePort =
    settings.backendInternalUrl && settings.backendInternalSecret
      ? new HttpControlPlaneClient({
          backendInternalUrl: settings.backendInternalUrl,
          backendInternalSecret: settings.backendInternalSecret,
          browserSessions
        })
      : new FakeControlPlaneClient();

  // Validador de sesión del backend: sólo cuando hay backend real configurado (mismo gate que
  // el control-plane real). Reusa la URL interna del backend; reenvía la cookie de sesión del
  // usuario a /api/v1/auth/me para confirmar que sigue viva antes de cada turno.
  const backendSession: BackendSessionValidatorPort | null = settings.backendInternalUrl
    ? new HttpBackendSessionValidator({
        backendBaseUrl: settings.backendInternalUrl,
        cookieName: settings.backendSessionCookieName ?? "session_token"
      })
    : null;

  const providerRegistry = new ProviderRegistry(adapters);
  const telemetry = new PinoTelemetry();

  // Discovery real: descubre los modelos de los proveedores REALES (no el fake) consultando
  // su /models con la credencial del usuario. El fake solo vive en el catálogo curado.
  const discoverableProviderIds = [
    ...new Set(
      catalogModels
        .map((model) => model.route.providerId)
        .filter((providerId) => providerId !== "fake")
    )
  ];
  const modelDiscovery = new ModelDiscoveryService({
    controlPlane,
    providerRegistry,
    modelCatalog,
    telemetry,
    discoverableProviderIds
  });

  return {
    settings,
    controlPlane,
    backendSession,
    modelCatalog,
    modelDiscovery,
    providerRegistry,
    turnStore: new InMemoryTurnStore(),
    limiter: new NoopRateLimiter(),
    telemetry,
    browserSessions
  };
}
