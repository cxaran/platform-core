import { afterEach, describe, expect, it } from "vitest";
import { createContainer } from "../../src/bootstrap/container.js";
import { buildApp } from "../../src/transport/http/app.js";
import type { FastifyInstance } from "fastify";
import type { GatewaySettings } from "../../src/config/settings.js";

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
  agentTicketSecret: "",
  opencodeBaseUrl: "https://opencode.test/v1",
  opencodeDefaultModel: "test-model"
};

let app: FastifyInstance | null = null;

async function build(): Promise<FastifyInstance> {
  const container = createContainer({ ...baseSettings });
  container.telemetry = { info() {}, warn() {}, error() {} };
  app = await buildApp(container);
  return app;
}

afterEach(async () => {
  if (app) {
    await app.close();
    app = null;
  }
});

function cookieHeader(setCookie: string | string[] | undefined): string {
  if (!setCookie) throw new Error("esperado set-cookie");
  return Array.isArray(setCookie) ? (setCookie[0] ?? "") : setCookie;
}

describe("readiness route", () => {
  it("readyz responde {status: ready}", async () => {
    const instance = await build();
    const response = await instance.inject({ method: "GET", url: "/readyz" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ready" });
  });
});

describe("browser-sessions: creacion (auth por ticket)", () => {
  it("ticket valido -> 200 con cookie de sesion y body {id, expires_at}", async () => {
    const instance = await build();
    const response = await instance.inject({
      method: "POST",
      url: "/v1/browser-sessions",
      payload: { ticket: "test-ticket" }
    });
    expect(response.statusCode).toBe(200);
    const setCookie = cookieHeader(response.headers["set-cookie"]);
    expect(setCookie).toContain("mg_session=");
    const body = response.json() as Record<string, unknown>;
    expect(typeof body.id).toBe("string");
    expect(typeof body.expires_at).toBe("string");
  });

  it("ticket invalido -> 401 INVALID_TICKET y no filtra el ticket enviado", async () => {
    const instance = await build();
    const response = await instance.inject({
      method: "POST",
      url: "/v1/browser-sessions",
      payload: { ticket: "ticket-incorrecto-secreto" }
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "INVALID_TICKET" });
    expect(response.headers["set-cookie"]).toBeUndefined();
    // MG-001: el secreto enviado no debe reflejarse en la respuesta.
    expect(response.body).not.toContain("ticket-incorrecto-secreto");
  });

  it("ticket ausente -> 401 INVALID_TICKET", async () => {
    const instance = await build();
    const response = await instance.inject({
      method: "POST",
      url: "/v1/browser-sessions",
      payload: {}
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "INVALID_TICKET" });
  });

  it("disponible tambien bajo el publicPathPrefix", async () => {
    const instance = await build();
    const response = await instance.inject({
      method: "POST",
      url: "/model-gateway/v1/browser-sessions",
      payload: { ticket: "test-ticket" }
    });
    expect(response.statusCode).toBe(200);
  });
});

describe("browser-sessions: cierre", () => {
  it("DELETE current con cookie valida -> 200 closed y limpia la cookie", async () => {
    const instance = await build();
    const created = await instance.inject({
      method: "POST",
      url: "/v1/browser-sessions",
      payload: { ticket: "test-ticket" }
    });
    const cookie = cookieHeader(created.headers["set-cookie"]);

    const response = await instance.inject({
      method: "DELETE",
      url: "/v1/browser-sessions/current",
      headers: { cookie }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "closed" });
    // La cookie se limpia (expira) en la respuesta.
    expect(cookieHeader(response.headers["set-cookie"])).toContain("mg_session=");
  });

  it("DELETE current sin cookie -> 200 closed (idempotente)", async () => {
    const instance = await build();
    const response = await instance.inject({
      method: "DELETE",
      url: "/v1/browser-sessions/current"
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "closed" });
  });
});
