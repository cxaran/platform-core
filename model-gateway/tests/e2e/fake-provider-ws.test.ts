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

function startMessage() {
  return {
    type: "turn.start",
    request_id: "req_1",
    profile_id: "profile_example_assistant",
    messages: [{ role: "user", content: [{ type: "text", text: "Resume." }] }],
    tools: [
      {
        name: "example.list_recent_consultations",
        description: "Lists recent consultations",
        input_schema: { type: "object", additionalProperties: false },
        strict: true
      }
    ],
    generation: { max_output_tokens: 1200, temperature: 0.2 }
  };
}

async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }

  return address.port;
}

async function createSession(app: FastifyInstance): Promise<string> {
  const sessionResponse = await app.inject({
    method: "POST",
    url: "/model-gateway/v1/browser-sessions",
    payload: { ticket: "test-ticket" }
  });
  const cookie = sessionResponse.headers["set-cookie"];
  if (!cookie) {
    throw new Error("Expected gateway session cookie");
  }

  if (Array.isArray(cookie)) {
    const first = cookie[0];
    if (!first) {
      throw new Error("Expected gateway session cookie value");
    }

    return first;
  }

  return cookie;
}

async function createTestApp(settings: Partial<GatewaySettings> = {}): Promise<{ app: FastifyInstance; container: GatewayContainer; port: number; cookie: string }> {
  const container = createContainer({ ...baseSettings, ...settings });
  container.telemetry = {
    info() {},
    warn() {},
    error() {}
  };
  const app = await buildApp(container);
  const health = await app.inject({ method: "GET", url: "/healthz" });
  expect(health.statusCode).toBe(200);
  const cookie = await createSession(app);
  const port = await listen(app);
  return { app, container, port, cookie };
}

describe("fake provider websocket flow", () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it("emits text.delta, tool_call.ready and completed", async () => {
    const setup = await createTestApp();
    app = setup.app;

    const events = await new Promise<unknown[]>((resolve, reject) => {
      const seen: unknown[] = [];
      const ws = new WebSocket(`ws://127.0.0.1:${setup.port}/model-gateway/v1/ws`, {
        headers: { Cookie: setup.cookie }
      });

      ws.on("open", () => {
        ws.send(JSON.stringify(startMessage()));
      });

      ws.on("message", (data) => {
        const event = JSON.parse(data.toString()) as Record<string, unknown>;
        seen.push(event);

        if (event.type === "turn.tool_call.ready") {
          ws.send(
            JSON.stringify({
              type: "turn.tool_result",
              turn_id: event.turn_id,
              call_id: event.call_id,
              result: { status: "success", content: { consultations: [] } }
            })
          );
        }

        if (event.type === "turn.completed") {
          ws.close();
          resolve(seen);
        }
      });

      ws.on("error", reject);
      setTimeout(() => reject(new Error("Timed out waiting for websocket completion")), 3000).unref();
    });

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "turn.text.delta" }),
        expect.objectContaining({ type: "turn.tool_call.ready" }),
        expect.objectContaining({ type: "turn.completed" })
      ])
    );
  });

  it("rejects websocket connections without a gateway session", async () => {
    const setup = await createTestApp();
    app = setup.app;

    const close = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${setup.port}/model-gateway/v1/ws`);
      ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
      ws.on("error", reject);
    });

    expect(close).toEqual({ code: 1008, reason: "Gateway session required" });
  });

  it("rejects websocket handshakes the browser declares cross-site", async () => {
    const setup = await createTestApp();
    app = setup.app;

    const close = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${setup.port}/model-gateway/v1/ws`, {
        headers: { Cookie: setup.cookie, "Sec-Fetch-Site": "cross-site" }
      });
      ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
      ws.on("error", reject);
    });

    expect(close).toEqual({ code: 1008, reason: "Cross-site request rejected" });
  });

  it("accepts same-origin websocket handshakes (fetch metadata)", async () => {
    const setup = await createTestApp();
    app = setup.app;

    const opened = await new Promise<boolean>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${setup.port}/model-gateway/v1/ws`, {
        headers: { Cookie: setup.cookie, "Sec-Fetch-Site": "same-origin" }
      });
      ws.on("open", () => {
        ws.close();
        resolve(true);
      });
      ws.on("close", (code) => resolve(code !== 1008));
      ws.on("error", reject);
    });

    expect(opened).toBe(true);
  });

  it("rejects tool_result payloads above the configured size limit", async () => {
    const setup = await createTestApp({ maxToolResultBytes: 16 });
    app = setup.app;

    const failed = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${setup.port}/model-gateway/v1/ws`, {
        headers: { Cookie: setup.cookie }
      });

      ws.on("open", () => ws.send(JSON.stringify(startMessage())));
      ws.on("message", (data) => {
        const event = JSON.parse(data.toString()) as Record<string, unknown>;
        if (event.type === "turn.tool_call.ready") {
          ws.send(
            JSON.stringify({
              type: "turn.tool_result",
              turn_id: event.turn_id,
              call_id: event.call_id,
              result: { status: "success", content: { oversized: "x".repeat(128) } }
            })
          );
        }

        if (event.type === "turn.failed") {
          ws.close();
          resolve(event);
        }
      });
      ws.on("error", reject);
    });

    expect(failed).toMatchObject({ type: "turn.failed", code: "TOOL_RESULT_TOO_LARGE" });
  });

  it("expires a turn while waiting for a tool result", async () => {
    const setup = await createTestApp({ toolResultTimeoutMs: 25 });
    app = setup.app;

    const failed = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${setup.port}/model-gateway/v1/ws`, {
        headers: { Cookie: setup.cookie }
      });

      ws.on("open", () => ws.send(JSON.stringify(startMessage())));
      ws.on("message", (data) => {
        const event = JSON.parse(data.toString()) as Record<string, unknown>;
        if (event.type === "turn.failed") {
          ws.close();
          resolve(event);
        }
      });
      ws.on("error", reject);
      setTimeout(() => reject(new Error("Timed out waiting for tool timeout")), 1000).unref();
    });

    expect(failed).toMatchObject({ type: "turn.failed", code: "TOOL_RESULT_TIMEOUT" });
  });

  it("cancels an active turn when the websocket closes", async () => {
    const setup = await createTestApp({ toolResultTimeoutMs: 1000 });
    app = setup.app;

    const turnId = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${setup.port}/model-gateway/v1/ws`, {
        headers: { Cookie: setup.cookie }
      });

      ws.on("open", () => ws.send(JSON.stringify(startMessage())));
      ws.on("message", (data) => {
        const event = JSON.parse(data.toString()) as Record<string, unknown>;
        if (event.type === "turn.tool_call.ready" && typeof event.turn_id === "string") {
          const id = event.turn_id;
          ws.close();
          resolve(id);
        }
      });
      ws.on("error", reject);
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(setup.container.turnStore.get(turnId)).resolves.toMatchObject({ status: "cancelled" });
  });

  it("con timeout finito: expira y luego DESCARTA en silencio el resultado tardio", async () => {
    // Timeout finito EXPLICITO (el default es 0 = desactivado): verifica que cuando se configura,
    // el turno expira; y que un resultado que llega DESPUES de expirar se descarta en silencio
    // (sin un segundo turn.failed), en vez del antiguo TURN_NOT_WAITING_FOR_TOOL en cascada.
    const setup = await createTestApp({ toolResultTimeoutMs: 25 });
    app = setup.app;

    const outcome = await new Promise<{ first: Record<string, unknown>; secondArrived: boolean }>(
      (resolve, reject) => {
        let pendingTurnId = "";
        let pendingCallId = "";
        let firstFailed: Record<string, unknown> | null = null;
        let secondArrived = false;
        const ws = new WebSocket(`ws://127.0.0.1:${setup.port}/model-gateway/v1/ws`, {
          headers: { Cookie: setup.cookie }
        });

        ws.on("open", () => ws.send(JSON.stringify(startMessage())));
        ws.on("message", (data) => {
          const event = JSON.parse(data.toString()) as Record<string, unknown>;
          if (
            event.type === "turn.tool_call.ready" &&
            typeof event.turn_id === "string" &&
            typeof event.call_id === "string"
          ) {
            pendingTurnId = event.turn_id;
            pendingCallId = event.call_id;
          }

          if (event.type === "turn.failed") {
            if (!firstFailed) {
              firstFailed = event;
              // Resultado TARDIO tras la expiracion: debe descartarse en silencio.
              ws.send(
                JSON.stringify({
                  type: "turn.tool_result",
                  turn_id: pendingTurnId,
                  call_id: pendingCallId,
                  result: { status: "success", content: {} }
                })
              );
              // Ventana para confirmar que NO llega un segundo fallo.
              setTimeout(() => {
                ws.close();
                resolve({ first: firstFailed!, secondArrived });
              }, 150).unref();
              return;
            }
            secondArrived = true;
          }
        });
        ws.on("error", reject);
        setTimeout(() => reject(new Error("Timed out waiting for timeout failure")), 1000).unref();
      }
    );

    expect(outcome.first).toMatchObject({ code: "TOOL_RESULT_TIMEOUT" });
    expect(outcome.secondArrived).toBe(false);
  });
});
