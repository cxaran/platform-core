import { GatewayError } from "../../kernel/errors.js";
import type { InMemoryBrowserSessionStore } from "../../application/browser-sessions/session-store.js";
import type { ControlPlanePort, TurnAuthorization } from "../../ports/control-plane.port.js";
import type { ProviderCredentialLease } from "../../ports/provider-adapter.port.js";

export interface HttpControlPlaneOptions {
  backendInternalUrl: string;
  backendInternalSecret: string;
  browserSessions: InMemoryBrowserSessionStore;
  fetchImpl?: typeof fetch;
}

// Mapa provider id del gateway → (provider, credential_type) del backend. Solo los ids que
// NO son 1:1 con el backend; el resto usa el provider id tal cual sin credential_type.
const PROVIDER_LEASE_MAP: Record<string, { provider: string; credentialType?: string }> = {
  openai: { provider: "openai", credentialType: "api_key" },
  openai_codex: { provider: "openai", credentialType: "oauth" }
};

interface CredentialLeaseResponse {
  lease_id: string;
  secret: string;
  expires_at: string;
  default_model?: string | null;
  // Id de cuenta ChatGPT: solo lo devuelve el backend para credenciales OAuth/Codex.
  account_id?: string | null;
}

/**
 * Control-plane real (B4): arrienda la credencial llamando al endpoint INTERNO de
 * FastAPI (autoridad de credenciales). El user_id sale de la identidad de la sesión
 * (propagada por B2 desde el ticket) y el provider de la autorización del turn.
 *
 * Seguridad: el secreto arrendado NUNCA se loguea; los errores solo exponen el código
 * de estado, jamás el cuerpo ni el secreto interno.
 *
 * El profileId que envía el navegador es el ``model.id`` (``providerId/providerModelId``)
 * del modelo seleccionado; aquí se PARSEA para arrendar la credencial del PROVEEDOR
 * correcto (p.ej. opencode_zen) y enrutar al modelo real. NO se valida contra el catálogo
 * curado: el modelo puede ser uno DESCUBIERTO del proveedor (no curado); su existencia y
 * capacidades las resuelve después el discovery (StartTurn). La identidad del usuario sale
 * de la sesión del navegador.
 */
export class HttpControlPlaneClient implements ControlPlanePort {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpControlPlaneOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async authorizeTurn(input: {
    browserSessionId: string;
    profileId: string;
  }): Promise<TurnAuthorization> {
    const session = this.options.browserSessions.get(input.browserSessionId);
    if (!session) {
      throw new GatewayError("SESSION_NOT_FOUND", "Browser session not found");
    }

    // El profileId es "providerId/providerModelId". Se parsea por el PRIMER "/": así se
    // soporta cualquier modelo del proveedor (incluidos los DESCUBIERTOS, no curados) sin
    // depender del catálogo. El discovery resuelve luego el modelo real y sus capacidades.
    const separator = input.profileId.indexOf("/");
    if (separator <= 0 || separator >= input.profileId.length - 1) {
      throw new GatewayError("INVALID_PROFILE_ID", "Model profile id must be 'providerId/modelId'", {
        profileId: input.profileId
      });
    }
    const providerId = input.profileId.slice(0, separator);
    const modelId = input.profileId.slice(separator + 1);

    return {
      userId: session.userId,
      sessionId: input.browserSessionId,
      tenantId: null,
      profileId: input.profileId,
      providerId,
      credentialId: session.userId,
      modelId,
      allowedCapabilities: {
        tools: true,
        structuredOutput: true,
        // P5: la política permite razonamiento; la capacidad real del modelo
        // (reasoning.support + compat) es el gate efectivo en la negociación. Modelos sin
        // razonamiento simplemente omiten el parámetro.
        reasoning: true,
        // La política permite imágenes; la capacidad real del modelo (inputModalities) es el
        // gate efectivo en la negociación. Modelos text-only rechazan el turno con imagen.
        images: true,
        audio: false
      },
      limits: {
        maxConcurrentTurns: 2,
        maxInputTokens: null,
        maxOutputTokens: 4096,
        maxTurnDurationSeconds: 60,
        maxToolResultBytes: 64 * 1024
      }
    };
  }

  async leaseCredential(input: {
    authorization: TurnAuthorization;
    purpose: "model_turn";
  }): Promise<ProviderCredentialLease> {
    // Proveedor FAKE (dev/tests, opt-in con GATEWAY_FAKE_ENABLED): no existe credencial en el
    // backend (su enum no lo declara) y el adaptador jamás toca la red, así que se emite un
    // lease sintético local en vez de llamar al puente interno. Sin efecto en producción:
    // sin el flag, el fake ni siquiera está registrado como proveedor.
    if (input.authorization.providerId === "fake") {
      return {
        leaseId: `fake_${Date.now()}`,
        secret: "fake-credential",
        expiresAt: new Date(Date.now() + 5 * 60 * 1000)
      };
    }
    const response = await this.postLease(
      input.authorization.userId,
      input.authorization.providerId
    );
    if (!response.ok) {
      throw new GatewayError(
        "CREDENTIAL_LEASE_FAILED",
        `Credential lease rejected with status ${response.status}`
      );
    }
    return this.mapLease((await response.json()) as CredentialLeaseResponse);
  }

  async leaseCredentialForProvider(input: {
    userId: string;
    providerId: string;
  }): Promise<ProviderCredentialLease | null> {
    let response: Response;
    try {
      response = await this.postLease(input.userId, input.providerId);
    } catch {
      // Discovery best-effort: si el backend no responde, ese proveedor no se ofrece.
      return null;
    }
    // 404 = el usuario no tiene credencial para ese proveedor (no es error: se omite).
    // Cualquier otro fallo también se trata como "no disponible" para no romper la lista.
    if (!response.ok) {
      return null;
    }
    return this.mapLease((await response.json()) as CredentialLeaseResponse);
  }

  private async postLease(userId: string, providerId: string): Promise<Response> {
    const base = this.options.backendInternalUrl.replace(/\/+$/, "");
    const url = `${base}/api/v1/internal/agent/credential-lease`;
    // Mapea el provider id del gateway al (provider, credential_type) del backend. "openai" y
    // "openai_codex" comparten el provider de backend "openai" pero distinta credencial (API
    // key vs OAuth): así ambos coexisten sin ambigüedad en el arriendo. El resto va 1:1.
    const mapped = PROVIDER_LEASE_MAP[providerId] ?? { provider: providerId };
    const body: Record<string, string> = { user_id: userId, provider: mapped.provider };
    if (mapped.credentialType) {
      body.credential_type = mapped.credentialType;
    }
    try {
      return await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-auth": this.options.backendInternalSecret
        },
        body: JSON.stringify(body)
      });
    } catch {
      // No se incluye el error original para no arriesgar fugas de secreto/URL.
      throw new GatewayError("CREDENTIAL_LEASE_UNAVAILABLE", "Credential lease request failed");
    }
  }

  private mapLease(data: CredentialLeaseResponse): ProviderCredentialLease {
    const lease: ProviderCredentialLease = {
      leaseId: data.lease_id,
      secret: data.secret,
      expiresAt: new Date(data.expires_at)
    };
    // Solo se agrega cuando el backend lo provee (credenciales OAuth/Codex); para API keys
    // queda ausente y el adaptador no emite el header chatgpt-account-id.
    if (data.account_id) {
      lease.accountId = data.account_id;
    }
    return lease;
  }

  async releaseCredentialLease(): Promise<void> {
    // El arriendo es de vida corta en FastAPI; B4 no expone un release explícito.
    return;
  }

  async reportTurnUsage(): Promise<void> {
    // El backend aún no expone un endpoint interno de reporte de uso; cuando exista, aquí va
    // el POST real. La llamada YA está cableada desde StartTurn/ResumeTurnAfterTool (no fatal),
    // así que implementar este método basta para activar el reporte.
    return;
  }
}
