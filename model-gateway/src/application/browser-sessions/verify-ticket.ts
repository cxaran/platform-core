import { jwtVerify } from "jose";

// MG-002: el connection-ticket es un JWT HS256 emitido por FastAPI (autoridad
// de la organización). El gateway solo verifica firma, audiencia y expiración y extrae la
// identidad (sub/sid). Nunca lo persiste ni lo loguea.
export const TICKET_AUDIENCE = "agent-gateway";

export interface VerifiedTicket {
  userId: string;
  sessionRef: string;
}

/**
 * Verifica un connection-ticket de FastAPI con el secreto compartido HS256.
 *
 * Valida firma, ``aud='agent-gateway'`` y ``exp`` (no expirado). Restringe el
 * algoritmo a HS256 (evita confusión de algoritmo) y exige los claims ``sub`` y
 * ``exp``. Lanza si el ticket es inválido; el llamador traduce eso a un rechazo
 * sin filtrar el ticket.
 */
export async function verifyConnectionTicket(
  token: string,
  secret: string
): Promise<VerifiedTicket> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key, {
    audience: TICKET_AUDIENCE,
    algorithms: ["HS256"],
    requiredClaims: ["sub", "exp"]
  });

  const userId = payload.sub;
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("connection ticket missing subject");
  }

  const sid = payload.sid;
  const sessionRef = typeof sid === "string" ? sid : "";

  return { userId, sessionRef };
}
