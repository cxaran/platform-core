import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { register } from "prom-client";
import { clearSessionCookie, createSessionCookie, parseCookie } from "./cookies.js";
import { createWebSocketHandler } from "../websocket/connection-handler.js";
import { verifyConnectionTicket } from "../../application/browser-sessions/verify-ticket.js";
import type { GatewayContainer } from "../../bootstrap/container.js";

interface SessionIdentity {
  userId: string;
  sessionRef: string;
}

/**
 * Resuelve la identidad de la browser-session a partir del ticket recibido.
 *
 * Orden de intento (MG-002):
 *   1. Si hay secreto compartido configurado, se intenta verificar el ticket como
 *      un JWT real de FastAPI (firma HS256, aud y exp). Es el path principal.
 *   2. Convivencia dev-only: fuera de producción, si el ticket coincide exactamente
 *      con GATEWAY_DEV_TICKET, se acepta como sesión de desarrollo.
 *
 * Devuelve null si ningún path valida. No se loguea el ticket ni el secreto.
 */
async function resolveSessionIdentity(
  ticket: string,
  container: GatewayContainer
): Promise<SessionIdentity | null> {
  if (container.settings.agentTicketSecret) {
    try {
      const verified = await verifyConnectionTicket(ticket, container.settings.agentTicketSecret);
      return { userId: verified.userId, sessionRef: verified.sessionRef };
    } catch {
      // Ticket JWT inválido (firma/aud/exp). Se cae al dev-ticket; no se filtra el token.
    }
  }

  if (container.settings.nodeEnv !== "production" && ticket === container.settings.devTicket) {
    return { userId: "dev-user", sessionRef: "dev-session" };
  }

  return null;
}

export async function buildApp(container: GatewayContainer) {
  const app = Fastify({ logger: false });
  await app.register(websocket, { options: { maxPayload: container.settings.maxWebSocketMessageBytes } });

  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/readyz", async () => ({ status: "ready" }));
  // Internal observability endpoint. Production routing must keep this off the public Internet.
  app.get("/metrics", async (_request, reply) => {
    reply.header("x-internal-observability", "true");
    reply.header("content-type", register.contentType);
    return register.metrics();
  });

  const registerSessionRoutes = (prefix: string) => {
    app.post(`${prefix}/v1/browser-sessions`, async (request, reply) => {
      const body = request.body as { ticket?: string } | undefined;
      if (!body?.ticket) {
        return reply.code(401).send({ code: "INVALID_TICKET", message: "Invalid browser session ticket" });
      }

      const identity = await resolveSessionIdentity(body.ticket, container);
      if (!identity) {
        return reply.code(401).send({ code: "INVALID_TICKET", message: "Invalid browser session ticket" });
      }

      const session = container.browserSessions.create(identity.userId, identity.sessionRef);
      reply.header(
        "set-cookie",
        createSessionCookie(container.settings.cookieName, session.id, container.settings.nodeEnv === "production")
      );
      return { id: session.id, expires_at: session.expiresAt.toISOString() };
    });

    app.delete(`${prefix}/v1/browser-sessions/current`, async (request, reply) => {
      const sessionId = parseCookie(request.headers.cookie, container.settings.cookieName);
      if (sessionId) {
        container.browserSessions.delete(sessionId);
        await container.turnStore.cancelByBrowserSession(sessionId);
      }

      reply.header(
        "set-cookie",
        clearSessionCookie(container.settings.cookieName, container.settings.nodeEnv === "production")
      );
      return { status: "closed" };
    });

    app.get(`${prefix}/v1/ws`, { websocket: true }, createWebSocketHandler(container));
  };

  registerSessionRoutes(container.settings.publicPathPrefix);
  if (container.settings.enableRootPathAlias) {
    // Temporary MG-001 alias for local tests and direct container access; canonical path uses publicPathPrefix.
    registerSessionRoutes("");
  }

  return app;
}
