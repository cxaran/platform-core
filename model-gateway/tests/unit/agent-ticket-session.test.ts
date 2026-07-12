import { afterEach, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { createContainer } from "../../src/bootstrap/container.js";
import { buildApp } from "../../src/transport/http/app.js";
import { TICKET_AUDIENCE } from "../../src/application/browser-sessions/verify-ticket.js";
import type { FastifyInstance } from "fastify";
import type { GatewayContainer } from "../../src/bootstrap/container.js";
import type { GatewaySettings } from "../../src/config/settings.js";

const SECRET = "shared-agent-ticket-secret";

const baseSettings: GatewaySettings = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 0,
  publicPathPrefix: "/model-gateway",
  enableRootPathAlias: true,
  cookieName: "mg_session",
  allowedOrigins: ["http://localhost:3000"],
  globalMaxContextTokens: 128000,
  safetyReserveTokens: 1024,
  maxWebSocketMessageBytes: 1024 * 1024,
  maxToolsPerTurn: 16,
  maxToolResultBytes: 64 * 1024,
  toolResultTimeoutMs: 1000,
  devTicket: "test-ticket",
  agentTicketSecret: SECRET,
  opencodeBaseUrl: "https://opencode.test/v1",
  opencodeDefaultModel: "test-model"
};

let app: FastifyInstance | null = null;
let container: GatewayContainer | null = null;

async function build(overrides: Partial<GatewaySettings> = {}): Promise<FastifyInstance> {
  container = createContainer({ ...baseSettings, ...overrides });
  container.telemetry = { info() {}, warn() {}, error() {} };
  app = await buildApp(container);
  return app;
}

afterEach(async () => {
  if (app) {
    await app.close();
    app = null;
  }
  container = null;
});

interface TicketClaims {
  sub?: string;
  sid?: string;
  aud?: string;
  expSeconds?: number;
  secret?: string;
}

async function makeTicket(claims: TicketClaims = {}): Promise<string> {
  const secret = new TextEncoder().encode(claims.secret ?? SECRET);
  const exp = claims.expSeconds ?? Math.floor(Date.now() / 1000) + 90;
  return new SignJWT({ sid: claims.sid ?? "session-version-1" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub ?? "user-123")
    .setAudience(claims.aud ?? TICKET_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(secret);
}

describe("MG-002 browser-session via FastAPI JWT ticket", () => {
  it("ticket JWT válido -> 200, setea cookie y asocia el user_id del claim sub", async () => {
    const instance = await build();
    const ticket = await makeTicket({ sub: "user-abc", sid: "sess-7" });

    const response = await instance.inject({
      method: "POST",
      url: "/v1/browser-sessions",
      payload: { ticket }
    });

    expect(response.statusCode).toBe(200);
    const setCookie = response.headers["set-cookie"];
    expect(Array.isArray(setCookie) ? setCookie[0] : setCookie).toContain("mg_session=");

    const body = response.json() as { id: string };
    const stored = container?.browserSessions.get(body.id);
    expect(stored?.userId).toBe("user-abc");
    expect(stored?.sessionRef).toBe("sess-7");
  });

  it("firma inválida -> 401 sin filtrar el ticket", async () => {
    const instance = await build();
    const ticket = await makeTicket({ secret: "otro-secreto-distinto" });

    const response = await instance.inject({
      method: "POST",
      url: "/v1/browser-sessions",
      payload: { ticket }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "INVALID_TICKET" });
    expect(response.body).not.toContain(ticket);
  });

  it("audiencia incorrecta -> 401", async () => {
    const instance = await build();
    const ticket = await makeTicket({ aud: "otra-audiencia" });

    const response = await instance.inject({
      method: "POST",
      url: "/v1/browser-sessions",
      payload: { ticket }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "INVALID_TICKET" });
  });

  it("ticket expirado -> 401", async () => {
    const instance = await build();
    const ticket = await makeTicket({ expSeconds: Math.floor(Date.now() / 1000) - 60 });

    const response = await instance.inject({
      method: "POST",
      url: "/v1/browser-sessions",
      payload: { ticket }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "INVALID_TICKET" });
  });

  it("convivencia: dev-ticket fuera de producción sigue creando sesión", async () => {
    const instance = await build();

    const response = await instance.inject({
      method: "POST",
      url: "/v1/browser-sessions",
      payload: { ticket: "test-ticket" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { id: string };
    expect(container?.browserSessions.get(body.id)?.userId).toBe("dev-user");
  });

  it("en producción el dev-ticket no se acepta -> 401", async () => {
    const instance = await build({ nodeEnv: "production" });

    const response = await instance.inject({
      method: "POST",
      url: "/v1/browser-sessions",
      payload: { ticket: "test-ticket" }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "INVALID_TICKET" });
  });

  it("en producción un JWT válido sí crea sesión", async () => {
    const instance = await build({ nodeEnv: "production" });
    const ticket = await makeTicket({ sub: "user-prod" });

    const response = await instance.inject({
      method: "POST",
      url: "/v1/browser-sessions",
      payload: { ticket }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { id: string };
    expect(container?.browserSessions.get(body.id)?.userId).toBe("user-prod");
  });
});
