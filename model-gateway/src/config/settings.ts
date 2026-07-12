export interface GatewaySettings {
  nodeEnv: string;
  host: string;
  port: number;
  publicPathPrefix: string;
  enableRootPathAlias: boolean;
  cookieName: string;
  // Nombre de la cookie de sesión del BACKEND (FastAPI) que el navegador manda al gateway bajo
  // el mismo origen. El gateway la reenvía a /api/v1/auth/me para verificar que la sesión del
  // usuario sigue viva antes de correr un turno. Opcional (default "session_token").
  backendSessionCookieName?: string | undefined;
  allowedOrigins: string[];
  globalMaxContextTokens: number;
  safetyReserveTokens: number;
  maxWebSocketMessageBytes: number;
  maxToolsPerTurn: number;
  maxToolResultBytes: number;
  toolResultTimeoutMs: number;
  // Proveedor FAKE (dev/tests): adaptador y modelo sintéticos, sin red ni credenciales,
  // usados para fijar el contrato del protocolo en los tests. DESACTIVADO por defecto: no
  // debe aparecer como proveedor ni modelo en runtime (dev ni producción). Opt-in explícito
  // con GATEWAY_FAKE_ENABLED=true.
  fakeEnabled?: boolean | undefined;
  devTicket: string;
  // MG-002: secreto HS256 compartido con FastAPI (AGENT_GATEWAY_TICKET_SECRET) para
  // verificar el JWT de connection-ticket. Si está vacío, solo opera el dev-ticket.
  agentTicketSecret: string;
  // B4: puente interno de arriendo de credencial. URL base del backend FastAPI y
  // secreto compartido (= AGENT_GATEWAY_INTERNAL_SECRET). Si faltan, se usa el
  // control-plane fake (dev/tests); si están, se usa el HttpControlPlaneClient real.
  backendInternalUrl?: string | undefined;
  backendInternalSecret?: string | undefined;
  // B5: proveedor real opencode (OpenAI-compatible). Base URL configurable (la key NO
  // se configura aquí: llega por arriendo de B4). El default es provisional y se afina
  // en B13 con la key real.
  opencodeBaseUrl: string;
  opencodeDefaultModel: string;
  // OpenCode Go: misma API OpenAI-compatible que Zen pero base URL y catalogo propios
  // (suscripcion). Opt-in: solo se registra el proveedor opencode_go si está habilitado.
  // Opcionales para no obligar a los tests a declararlos (default: deshabilitado).
  opencodeGoEnabled?: boolean | undefined;
  opencodeGoBaseUrl?: string | undefined;
  opencodeGoDefaultModel?: string | undefined;
  // OpenAI API key (P6, opt-in): provider id "openai", familia chat/completions contra
  // api.openai.com. La key llega por arriendo (B4/B3), no se configura aquí.
  openaiEnabled?: boolean | undefined;
  openaiBaseUrl?: string | undefined;
  openaiDefaultModel?: string | undefined;
  // Codex / suscripción ChatGPT (opt-in, INDEPENDIENTE de la API key): provider id
  // "openai_codex", app-server Responses contra chatgpt.com/backend-api/codex. Arrienda la
  // credencial OAuth (B10). Ambos pueden estar activos a la vez. clientVersion: gating del
  // discovery /models de la suscripción.
  openaiCodexEnabled?: boolean | undefined;
  openaiCodexBaseUrl?: string | undefined;
  openaiCodexDefaultModel?: string | undefined;
  openaiCodexClientVersion?: string | undefined;
  // Anthropic (opt-in): familia de cable Messages API (distinta a OpenAI). La API key NO se
  // configura aquí (llega por arriendo de B4/B3, cifrada por usuario). Solo se registra el
  // proveedor anthropic si está habilitado. Opcionales para no obligar a los tests.
  anthropicEnabled?: boolean | undefined;
  anthropicBaseUrl?: string | undefined;
  anthropicDefaultModel?: string | undefined;
  // Google Gemini (opt-in): familia de cable Generative Language API (distinta a OpenAI y
  // Anthropic). La API key NO se configura aquí (llega por arriendo de B4/B3, cifrada por
  // usuario). Solo se registra el proveedor gemini si está habilitado. Opcionales para los tests.
  geminiEnabled?: boolean | undefined;
  geminiBaseUrl?: string | undefined;
  geminiDefaultModel?: string | undefined;
  // OpenRouter (opt-in): OpenAI-compatible con DISCOVERY RICO (su /models trae metadatos reales
  // de capacidad). La API key NO se configura aquí (llega por arriendo de B4/B3). Solo se
  // registra el proveedor openrouter si está habilitado. Opcionales para los tests.
  openrouterEnabled?: boolean | undefined;
  openrouterBaseUrl?: string | undefined;
  openrouterDefaultModel?: string | undefined;
  // Runtime LOCAL / on-prem (Ollama / vLLM), opt-in: inferencia en la de la organización, sin nube. Base
  // URL OpenAI-compatible configurable; suele NO requerir API key (el arriendo puede venir
  // vacío). Opcionales para los tests.
  localEnabled?: boolean | undefined;
  localBaseUrl?: string | undefined;
  localDefaultModel?: string | undefined;
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  return raw === "true" || raw === "1";
}

export function loadSettings(): GatewaySettings {
  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    host: process.env.HOST ?? "0.0.0.0",
    port: numberFromEnv("PORT", 8081),
    publicPathPrefix: process.env.GATEWAY_PUBLIC_PATH_PREFIX ?? "/model-gateway",
    enableRootPathAlias: booleanFromEnv("GATEWAY_ENABLE_ROOT_PATH_ALIAS", true),
    cookieName: process.env.GATEWAY_PUBLIC_COOKIE_NAME ?? "mg_session",
    backendSessionCookieName: process.env.GATEWAY_BACKEND_SESSION_COOKIE_NAME ?? "session_token",
    allowedOrigins: (process.env.GATEWAY_ALLOWED_ORIGINS ?? "http://localhost:3000")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    globalMaxContextTokens: numberFromEnv("GATEWAY_GLOBAL_MAX_CONTEXT_TOKENS", 128000),
    safetyReserveTokens: numberFromEnv("GATEWAY_SAFETY_RESERVE_TOKENS", 1024),
    maxWebSocketMessageBytes: numberFromEnv("GATEWAY_MAX_WS_MESSAGE_BYTES", 1024 * 1024),
    // El navegador declara TODO el catálogo efectivo (gateado por rol) al modelo, sin
    // descubrimiento: el camino común no necesita tool_search. Por eso el tope es alto (cubre el
    // catálogo curado + las tools derivadas del contrato). Ajustar a la baja sólo si se vuelve a
    // un esquema de descubrimiento.
    maxToolsPerTurn: numberFromEnv("GATEWAY_MAX_TOOLS_PER_TURN", 200),
    maxToolResultBytes: numberFromEnv("GATEWAY_MAX_TOOL_RESULT_BYTES", 64 * 1024),
    // 0 = SIN timeout de resultado de tool (default). En platform-core toda tool de ESCRITURA
    // espera una aprobación HUMANA (P1) de duración ilimitada: un timeout fijo mataría el turno
    // mientras el usuario revisa el borrador. La fuga de turnos abandonados ya la cubre el cierre
    // del socket (``cancelByBrowserSession``). Se puede fijar un timeout finito en ms con
    // GATEWAY_TOOL_RESULT_TIMEOUT_MS para entornos que lo requieran.
    toolResultTimeoutMs: numberFromEnv("GATEWAY_TOOL_RESULT_TIMEOUT_MS", 0),
    fakeEnabled: process.env.GATEWAY_FAKE_ENABLED === "true",
    devTicket: process.env.GATEWAY_DEV_TICKET ?? "dev-ticket",
    agentTicketSecret: process.env.GATEWAY_AGENT_TICKET_SECRET ?? "",
    backendInternalUrl: process.env.GATEWAY_BACKEND_INTERNAL_URL || undefined,
    backendInternalSecret: process.env.GATEWAY_BACKEND_INTERNAL_SECRET || undefined,
    opencodeBaseUrl: process.env.GATEWAY_OPENCODE_BASE_URL ?? "https://opencode.ai/zen/v1",
    // Modelo curado por defecto: debe existir en el catálogo REAL de opencode zen
    // (su /models no expone "gpt-4o-mini"). claude-haiku-4-5 es real, rápido y con
    // soporte de tools; se puede sobreescribir con GATEWAY_OPENCODE_DEFAULT_MODEL.
    opencodeDefaultModel: process.env.GATEWAY_OPENCODE_DEFAULT_MODEL ?? "claude-haiku-4-5",
    // OpenCode Go (suscripcion): la MISMA key opencode arrendada sirve, pero contra el
    // endpoint Go y con provider id opencode_go. Modelo por defecto del bundle Go.
    opencodeGoEnabled: process.env.GATEWAY_OPENCODE_GO_ENABLED === "true",
    opencodeGoBaseUrl: process.env.GATEWAY_OPENCODE_GO_BASE_URL ?? "https://opencode.ai/zen/go/v1",
    opencodeGoDefaultModel: process.env.GATEWAY_OPENCODE_GO_DEFAULT_MODEL ?? "qwen3.7-plus",
    // OpenAI API key (opt-in): provider id "openai", chat_completions contra api.openai.com.
    // El discovery /models lista en vivo los modelos de la cuenta.
    openaiEnabled: process.env.GATEWAY_OPENAI_ENABLED === "true",
    openaiBaseUrl: process.env.GATEWAY_OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    openaiDefaultModel: process.env.GATEWAY_OPENAI_DEFAULT_MODEL ?? "gpt-4o-mini",
    // Codex / suscripción ChatGPT (opt-in, independiente): provider id "openai_codex" contra
    // chatgpt.com/backend-api/codex. Discovery en vivo vía /models?client_version=…; el modelo
    // por defecto es solo fila curada de fallback. gpt-5.5 es el frontier vigente (jun-2026).
    openaiCodexEnabled: process.env.GATEWAY_OPENAI_CODEX_ENABLED === "true",
    openaiCodexBaseUrl: process.env.GATEWAY_OPENAI_CODEX_BASE_URL ?? "https://chatgpt.com/backend-api/codex",
    openaiCodexDefaultModel: process.env.GATEWAY_OPENAI_CODEX_DEFAULT_MODEL ?? "gpt-5.5",
    openaiCodexClientVersion: process.env.GATEWAY_OPENAI_CODEX_CLIENT_VERSION ?? "1.0.0",
    // Anthropic (opt-in). La key llega por arriendo; el modelo por defecto se registra como
    // fila curada (capacidades por mapa documentado) y el discovery añade los reales de /v1/models.
    anthropicEnabled: process.env.GATEWAY_ANTHROPIC_ENABLED === "true",
    anthropicBaseUrl: process.env.GATEWAY_ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1",
    anthropicDefaultModel: process.env.GATEWAY_ANTHROPIC_DEFAULT_MODEL ?? "claude-sonnet-4-5",
    // Google Gemini (opt-in). La key llega por arriendo; el modelo por defecto se registra como
    // fila curada y el discovery añade los reales de /v1beta/models (con sus límites de tokens).
    geminiEnabled: process.env.GATEWAY_GEMINI_ENABLED === "true",
    geminiBaseUrl: process.env.GATEWAY_GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta",
    geminiDefaultModel: process.env.GATEWAY_GEMINI_DEFAULT_MODEL ?? "gemini-2.5-flash",
    // OpenRouter (opt-in). La key llega por arriendo; el modelo por defecto se registra como
    // fila curada (capacidades unknown hasta el discovery, que SÍ trae metadatos reales).
    openrouterEnabled: process.env.GATEWAY_OPENROUTER_ENABLED === "true",
    openrouterBaseUrl: process.env.GATEWAY_OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
    openrouterDefaultModel: process.env.GATEWAY_OPENROUTER_DEFAULT_MODEL ?? "openai/gpt-4o-mini",
    // Runtime local (opt-in). Default: el endpoint OpenAI-compatible de Ollama. vLLM funciona
    // apuntando GATEWAY_LOCAL_BASE_URL a su /v1. La key suele no requerirse (puede venir vacía).
    localEnabled: process.env.GATEWAY_LOCAL_ENABLED === "true",
    localBaseUrl: process.env.GATEWAY_LOCAL_BASE_URL ?? "http://localhost:11434/v1",
    localDefaultModel: process.env.GATEWAY_LOCAL_DEFAULT_MODEL ?? "llama3.1:8b"
  };
}
