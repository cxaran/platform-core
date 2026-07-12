import type {
  BackendSessionIdentity,
  BackendSessionValidatorPort
} from "../../ports/backend-session.port.js";

export interface HttpBackendSessionValidatorOptions {
  // Base de FastAPI alcanzable por el gateway (p. ej. http://backend:8000). Se reutiliza la
  // misma URL interna del puente de credenciales.
  backendBaseUrl: string;
  // Nombre de la cookie de sesión del backend a reenviar (por defecto ``session_token``).
  cookieName: string;
  fetchImpl?: typeof fetch;
}

/**
 * Validador real de sesión del backend: llama a ``GET /api/v1/auth/me`` REENVIANDO la cookie
 * de sesión del usuario. FastAPI corre su validación normal (firma, ``User.token``, expiración,
 * usuario activo) y responde 200 con el usuario si la sesión vive, o 401 si no.
 *
 * Seguridad / robustez:
 *  - La cookie NUNCA se loguea ni se persiste.
 *  - Fail-closed: cualquier fallo (backend inalcanzable, JSON inválido, no-200, cookie ausente)
 *    devuelve ``null`` → el llamador NO autoriza el turno.
 */
export class HttpBackendSessionValidator implements BackendSessionValidatorPort {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpBackendSessionValidatorOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async validate(sessionCookieValue: string | null): Promise<BackendSessionIdentity | null> {
    if (!sessionCookieValue) {
      return null;
    }
    const base = this.options.backendBaseUrl.replace(/\/+$/, "");
    const url = `${base}/api/v1/auth/me`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: { cookie: `${this.options.cookieName}=${sessionCookieValue}` }
      });
    } catch {
      // Backend inalcanzable: fail-closed (no se autoriza el turno). No se filtra el error.
      return null;
    }

    if (!response.ok) {
      return null;
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return null;
    }

    const id = (data as { id?: unknown }).id;
    return typeof id === "string" && id.length > 0 ? { userId: id } : null;
  }
}
