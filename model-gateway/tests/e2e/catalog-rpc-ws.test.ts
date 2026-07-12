import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createContainer } from "../../src/bootstrap/container.js";
import { buildApp } from "../../src/transport/http/app.js";
import type { FastifyInstance } from "fastify";
import type { GatewayContainer } from "../../src/bootstrap/container.js";
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
  opencodeDefaultModel: "test-model",
  fakeEnabled: true
};

type Event = Record<string, unknown>;

async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }
  return address.port;
}

async function createSession(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/model-gateway/v1/browser-sessions",
    payload: { ticket: "test-ticket" }
  });
  const cookie = response.headers["set-cookie"];
  if (!cookie) throw new Error("Expected gateway session cookie");
  return Array.isArray(cookie) ? (cookie[0] as string) : cookie;
}

async function createTestApp(settings: Partial<GatewaySettings> = {}): Promise<{
  app: FastifyInstance;
  container: GatewayContainer;
  port: number;
  cookie: string;
}> {
  const container = createContainer({ ...baseSettings, ...settings });
  container.telemetry = { info() {}, warn() {}, error() {} };
  const app = await buildApp(container);
  const cookie = await createSession(app);
  const port = await listen(app);
  return { app, container, port, cookie };
}

/** Abre un WS, ejecuta `onOpen` y resuelve con el primer evento que cumpla `until`. */
function withSocket<T>(
  port: number,
  cookie: string,
  onOpen: (ws: WebSocket) => void,
  until: (event: Event, ws: WebSocket) => T | undefined
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/model-gateway/v1/ws`, {
      headers: { Cookie: cookie }
    });
    ws.on("open", () => onOpen(ws));
    ws.on("message", (data) => {
      const event = JSON.parse(data.toString()) as Event;
      const result = until(event, ws);
      if (result !== undefined) {
        ws.close();
        resolve(result);
      }
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("Timed out waiting for websocket event")), 3000).unref();
  });
}

function startMessage(withTools: boolean) {
  return {
    type: "turn.start",
    request_id: "req_1",
    profile_id: "profile_example_assistant",
    messages: [{ role: "user", content: [{ type: "text", text: "Hola" }] }],
    tools: withTools
      ? [{ name: "example.list", description: "Lista", input_schema: { type: "object" }, strict: false }]
      : [],
    generation: { max_output_tokens: 1200 }
  };
}

describe("catálogo y control sobre WS (B6)", () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it("models.list devuelve el catálogo con capacidades (fake + opencode)", async () => {
    const setup = await createTestApp();
    app = setup.app;

    const result = await withSocket<Event>(
      setup.port,
      setup.cookie,
      (ws) => ws.send(JSON.stringify({ type: "models.list", request_id: "r1" })),
      (event) => (event.type === "models.list.result" ? event : undefined)
    );

    expect(result.request_id).toBe("r1");
    const models = result.models as Event[];
    const protocols = models.map((m) => m.protocol);
    expect(protocols).toContain("opencode_zen");
    expect(protocols).toContain("fake");

    const opencode = models.find((m) => m.protocol === "opencode_zen");
    expect(opencode).toBeDefined();
    const caps = (opencode as Event).capabilities as Event;
    // Capacidades enriquecidas (B5) presentes en la forma de cable.
    expect(caps).toHaveProperty("compat");
    expect(caps).toHaveProperty("effective_context_tokens");
    expect(Array.isArray(caps.input_modalities)).toBe(true);
  });

  it("provider.status lista los protocolos registrados con disponibilidad", async () => {
    const setup = await createTestApp();
    app = setup.app;

    const result = await withSocket<Event>(
      setup.port,
      setup.cookie,
      (ws) => ws.send(JSON.stringify({ type: "provider.status", request_id: "r2" })),
      (event) => (event.type === "provider.status.result" ? event : undefined)
    );

    expect(result.request_id).toBe("r2");
    const providers = result.providers as Event[];
    const byProtocol = Object.fromEntries(providers.map((p) => [p.protocol, p]));
    expect(byProtocol.opencode_zen).toMatchObject({ registered: true, available: true });
    expect(byProtocol.fake).toMatchObject({ registered: true, available: true });
  });

  it("agent.cancel_turn cancela un turn en waiting_for_tool", async () => {
    const setup = await createTestApp({ toolResultTimeoutMs: 5000 });
    app = setup.app;

    const cancelledId = await new Promise<string>((resolve, reject) => {
      let turnId = "";
      const ws = new WebSocket(`ws://127.0.0.1:${setup.port}/model-gateway/v1/ws`, {
        headers: { Cookie: setup.cookie }
      });
      ws.on("open", () => ws.send(JSON.stringify(startMessage(true))));
      ws.on("message", (data) => {
        const event = JSON.parse(data.toString()) as Event;
        if (event.type === "turn.tool_call.ready" && typeof event.turn_id === "string") {
          turnId = event.turn_id;
          ws.send(JSON.stringify({ type: "agent.cancel_turn", request_id: "rc", turn_id: turnId }));
        }
        if (event.type === "agent.cancel_turn.result") {
          ws.close();
          resolve(turnId);
        }
      });
      ws.on("error", reject);
      setTimeout(() => reject(new Error("Timed out waiting for cancel")), 3000).unref();
    });

    await expect(setup.container.turnStore.get(cancelledId)).resolves.toMatchObject({
      status: "cancelled"
    });
    const turn = await setup.container.turnStore.get(cancelledId);
    expect(turn?.pendingToolCalls.size).toBe(0);
  });

  it("agent.cancel_turn sin turn activo devuelve rpc.error NO_ACTIVE_TURN", async () => {
    const setup = await createTestApp();
    app = setup.app;

    const error = await withSocket<Event>(
      setup.port,
      setup.cookie,
      (ws) => ws.send(JSON.stringify({ type: "agent.cancel_turn", request_id: "rc" })),
      (event) => (event.type === "rpc.error" ? event : undefined)
    );

    expect(error).toMatchObject({ type: "rpc.error", request_id: "rc", code: "NO_ACTIVE_TURN" });
  });

  it("un turn de texto emite delta + snapshot coherentes", async () => {
    const setup = await createTestApp();
    app = setup.app;

    const deltas = await new Promise<Event[]>((resolve, reject) => {
      const seen: Event[] = [];
      const ws = new WebSocket(`ws://127.0.0.1:${setup.port}/model-gateway/v1/ws`, {
        headers: { Cookie: setup.cookie }
      });
      ws.on("open", () => ws.send(JSON.stringify(startMessage(false))));
      ws.on("message", (data) => {
        const event = JSON.parse(data.toString()) as Event;
        if (event.type === "turn.text.delta") seen.push(event);
        if (event.type === "turn.completed") {
          ws.close();
          resolve(seen);
        }
      });
      ws.on("error", reject);
      setTimeout(() => reject(new Error("Timed out waiting for text deltas")), 3000).unref();
    });

    expect(deltas.length).toBeGreaterThanOrEqual(2);
    // El snapshot acumula los deltas en orden.
    let accumulated = "";
    for (const delta of deltas) {
      accumulated += delta.delta as string;
      expect(delta.snapshot).toBe(accumulated);
    }
  });
});
