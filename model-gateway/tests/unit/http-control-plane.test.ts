import { describe, expect, it } from "vitest";
import { HttpControlPlaneClient } from "../../src/infrastructure/control-plane/http-control-plane.client.js";
import { InMemoryBrowserSessionStore } from "../../src/application/browser-sessions/session-store.js";
import { GatewayError } from "../../src/kernel/errors.js";
import type { TurnAuthorization } from "../../src/ports/control-plane.port.js";

const BACKEND_URL = "http://backend:8000";
const INTERNAL_SECRET = "internal-shared-secret";
// El profileId es el model.id (providerId/providerModelId). authorizeTurn lo PARSEA (no usa
// catálogo): así soporta modelos descubiertos del proveedor, no solo los curados.
const OPENCODE_PROFILE = "opencode_zen/gpt-4o-mini";

interface Captured {
  url: string;
  init: RequestInit;
}

function build(responder: (captured: Captured) => Response) {
  const calls: Captured[] = [];
  const browserSessions = new InMemoryBrowserSessionStore();
  const session = browserSessions.create("user-123", "session-ref-7");
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const captured = { url: String(input), init: init ?? {} };
    calls.push(captured);
    return responder(captured);
  }) as unknown as typeof fetch;

  const client = new HttpControlPlaneClient({
    backendInternalUrl: BACKEND_URL,
    backendInternalSecret: INTERNAL_SECRET,
    browserSessions,
    fetchImpl
  });

  return { client, calls, browserSessions, sessionId: session.id };
}

async function authorize(client: HttpControlPlaneClient, sessionId: string): Promise<TurnAuthorization> {
  return client.authorizeTurn({ browserSessionId: sessionId, profileId: OPENCODE_PROFILE });
}

describe("HttpControlPlaneClient", () => {
  it("authorizeTurn resuelve el user_id real desde la sesión del navegador", async () => {
    const { client, sessionId } = build(() => new Response("{}", { status: 200 }));
    const authorization = await authorize(client, sessionId);
    expect(authorization.userId).toBe("user-123");
    expect(authorization.sessionId).toBe(sessionId);
  });

  it("authorizeTurn parsea provider/model reales del profileId (no fijo 'fake')", async () => {
    const { client, sessionId } = build(() => new Response("{}", { status: 200 }));
    const authorization = await authorize(client, sessionId);
    expect(authorization.providerId).toBe("opencode_zen");
    expect(authorization.modelId).toBe("gpt-4o-mini");
    expect(authorization.profileId).toBe(OPENCODE_PROFILE);
  });

  it("authorizeTurn parsea un modelo DESCUBIERTO aunque no esté en el catálogo curado", async () => {
    const { client, sessionId } = build(() => new Response("{}", { status: 200 }));
    const authorization = await client.authorizeTurn({
      browserSessionId: sessionId,
      profileId: "opencode_zen/deepseek-v4-flash-free"
    });
    expect(authorization.providerId).toBe("opencode_zen");
    expect(authorization.modelId).toBe("deepseek-v4-flash-free");
  });

  it("authorizeTurn rechaza un profileId mal formado (sin 'providerId/modelId')", async () => {
    const { client, sessionId } = build(() => new Response("{}", { status: 200 }));
    await expect(
      client.authorizeTurn({ browserSessionId: sessionId, profileId: "sinbarra" })
    ).rejects.toBeInstanceOf(GatewayError);
  });

  it("authorizeTurn falla si la sesión no existe", async () => {
    const { client } = build(() => new Response("{}", { status: 200 }));
    await expect(
      client.authorizeTurn({ browserSessionId: "bs_inexistente", profileId: "p" })
    ).rejects.toBeInstanceOf(GatewayError);
  });

  it("leaseCredential hace el POST correcto y mapea la respuesta", async () => {
    const expiresAt = new Date(Date.now() + 120_000).toISOString();
    const { client, calls, sessionId } = build(
      () =>
        new Response(
          JSON.stringify({
            lease_id: "lease-abc",
            secret: "sk-leased-secret",
            expires_at: expiresAt,
            default_model: "gpt-4o"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );

    const authorization = await authorize(client, sessionId);
    const lease = await client.leaseCredential({ authorization, purpose: "model_turn" });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("http://backend:8000/api/v1/internal/agent/credential-lease");
    expect(call.init.method).toBe("POST");
    const headers = call.init.headers as Record<string, string>;
    expect(headers["x-internal-auth"]).toBe(INTERNAL_SECRET);
    expect(JSON.parse(String(call.init.body))).toEqual({
      user_id: "user-123",
      provider: authorization.providerId
    });

    expect(lease).toEqual({
      leaseId: "lease-abc",
      secret: "sk-leased-secret",
      expiresAt: new Date(expiresAt)
    });
  });

  it("openai_codex arrienda el provider 'openai' con credential_type 'oauth'", async () => {
    const { client, calls, browserSessions } = build(
      () => new Response(JSON.stringify({ lease_id: "l", secret: "s", expires_at: new Date().toISOString() }), { status: 200, headers: { "content-type": "application/json" } })
    );
    const session = browserSessions.create("user-cdx", "ref");
    const authorization = await client.authorizeTurn({ browserSessionId: session.id, profileId: "openai_codex/gpt-5.5" });
    await client.leaseCredential({ authorization, purpose: "model_turn" });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      user_id: "user-cdx",
      provider: "openai",
      credential_type: "oauth"
    });
  });

  it("openai (API key) arrienda el provider 'openai' con credential_type 'api_key'", async () => {
    const { client, calls, browserSessions } = build(
      () => new Response(JSON.stringify({ lease_id: "l", secret: "s", expires_at: new Date().toISOString() }), { status: 200, headers: { "content-type": "application/json" } })
    );
    const session = browserSessions.create("user-key", "ref");
    const authorization = await client.authorizeTurn({ browserSessionId: session.id, profileId: "openai/gpt-4o" });
    await client.leaseCredential({ authorization, purpose: "model_turn" });
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      user_id: "user-key",
      provider: "openai",
      credential_type: "api_key"
    });
  });

  it("leaseCredential mapea account_id (credencial OAuth/Codex) a accountId", async () => {
    const expiresAt = new Date(Date.now() + 120_000).toISOString();
    const { client, sessionId } = build(
      () =>
        new Response(
          JSON.stringify({
            lease_id: "lease-oauth",
            secret: "oauth-access-token",
            expires_at: expiresAt,
            account_id: "acct_999"
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );
    const authorization = await authorize(client, sessionId);
    const lease = await client.leaseCredential({ authorization, purpose: "model_turn" });
    expect(lease.accountId).toBe("acct_999");
  });

  it("404 sin credencial -> GatewayError sin filtrar el secreto interno", async () => {
    const { client, sessionId } = build(
      () => new Response(JSON.stringify({ code: "credential_not_found" }), { status: 404 })
    );
    const authorization = await authorize(client, sessionId);
    try {
      await client.leaseCredential({ authorization, purpose: "model_turn" });
      throw new Error("se esperaba un error");
    } catch (error) {
      expect(error).toBeInstanceOf(GatewayError);
      const message = (error as GatewayError).message;
      expect(message).toContain("404");
      expect(message).not.toContain(INTERNAL_SECRET);
    }
  });

  it("401 header inválido -> GatewayError", async () => {
    const { client, sessionId } = build(() => new Response("{}", { status: 401 }));
    const authorization = await authorize(client, sessionId);
    await expect(
      client.leaseCredential({ authorization, purpose: "model_turn" })
    ).rejects.toBeInstanceOf(GatewayError);
  });
});
