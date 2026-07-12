import test from "node:test";
import assert from "node:assert/strict";

import { AgentClient, type GatewaySocketLike } from "./agent-client.ts";
import { initialTurnState, reduceTurnEvent } from "./turn-reducer.ts";
import type { ServerEvent } from "./protocol.ts";

const GATEWAY_URL = "http://gateway.test/model-gateway";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

class FakeSocket implements GatewaySocketLike {
  sent: string[] = [];
  closed = false;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    this.onclose?.({});
  }
  emitOpen(): void {
    this.onopen?.({});
  }
  emitMessage(event: ServerEvent): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
  emitError(): void {
    this.onerror?.({});
  }
}

function mockFetch(
  t: { mock: { method: typeof import("node:test").mock.method } },
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return handler(String(url), init ?? {});
  });
  return { calls };
}

test("handshake: pide el ticket y crea la browser-session, luego conecta", async (t) => {
  const fake = new FakeSocket();
  const statuses: string[] = [];
  const { calls } = mockFetch(t, (url) => {
    if (url.endsWith("/api/v1/agent/connection-ticket")) {
      return jsonResponse(200, { ticket: "tok-123", expires_at: "2099-01-01T00:00:00Z" });
    }
    if (url.includes("/v1/browser-sessions")) {
      return jsonResponse(201, { session_id: "s1" });
    }
    throw new Error(`URL inesperada: ${url}`);
  });

  const client = new AgentClient({
    gatewayUrl: GATEWAY_URL,
    onEvent: () => {},
    onStatusChange: (status) => statuses.push(status),
    webSocketFactory: () => fake,
  });

  await client.connect();
  fake.emitOpen();

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/v1/agent/connection-ticket");
  assert.equal(calls[0].init.method, "POST");
  assert.ok(calls[1].url.endsWith("/model-gateway/v1/browser-sessions"));
  assert.equal(calls[1].init.body, JSON.stringify({ ticket: "tok-123" }));
  assert.equal(calls[1].init.credentials, "include");
  assert.deepEqual(statuses, ["connecting", "connected"]);
  assert.equal(client.getStatus(), "connected");
});

test("reducer: acumula el texto del asistente desde delta+snapshot", () => {
  let state = initialTurnState();
  state = reduceTurnEvent(state, { type: "turn.started", turn_id: "t1" });
  assert.equal(state.status, "running");

  state = reduceTurnEvent(state, { type: "turn.text.delta", turn_id: "t1", delta: "Hola ", snapshot: "Hola " });
  state = reduceTurnEvent(state, {
    type: "turn.text.delta",
    turn_id: "t1",
    delta: "mundo",
    snapshot: "Hola mundo",
  });
  assert.equal(state.assistantText, "Hola mundo");

  state = reduceTurnEvent(state, {
    type: "turn.completed",
    turn_id: "t1",
    usage: { input_tokens: 1, output_tokens: 2, cached_input_tokens: null, cache_write_tokens: null },
  });
  assert.equal(state.status, "completed");
  assert.equal(state.assistantText, "Hola mundo");
});

test("reducer: tool_call.ready marca el turno a la espera de la tool", () => {
  // El despacho de la tool ocurre en el panel desde el EVENTO (handleToolCall); el reducer sólo
  // refleja el estado del turno.
  let state = initialTurnState();
  state = reduceTurnEvent(state, { type: "turn.started", turn_id: "t1" });
  state = reduceTurnEvent(state, {
    type: "turn.tool_call.ready",
    turn_id: "t1",
    call_id: "c1",
    tool_name: "clinical.search",
    arguments: { q: "x" },
  });
  assert.equal(state.status, "waiting_for_tool");
  assert.equal(state.turnId, "t1");
});

test("startTurn y cancelTurn envían los mensajes tipados", async (t) => {
  const fake = new FakeSocket();
  mockFetch(t, (url) => {
    if (url.endsWith("/connection-ticket")) {
      return jsonResponse(200, { ticket: "tok", expires_at: "2099-01-01T00:00:00Z" });
    }
    return jsonResponse(201, {});
  });

  const client = new AgentClient({
    gatewayUrl: GATEWAY_URL,
    onEvent: () => {},
    onStatusChange: () => {},
    webSocketFactory: () => fake,
  });
  await client.connect();
  fake.emitOpen();

  const requestId = client.startTurn({
    profileId: "profile_clinical_assistant",
    messages: [{ role: "user", content: [{ type: "text", text: "Hola" }] }],
    generation: { max_output_tokens: 1000 },
  });
  assert.ok(requestId);
  client.cancelTurn("turn-9");

  const sent = fake.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  assert.equal(sent[0].type, "turn.start");
  assert.equal(sent[0].profile_id, "profile_clinical_assistant");
  assert.equal(sent[1].type, "agent.cancel_turn");
  assert.equal(sent[1].turn_id, "turn-9");
});

test("degrada a 'unavailable' cuando el WS se cierra inesperadamente", async (t) => {
  const fake = new FakeSocket();
  const statuses: string[] = [];
  mockFetch(t, (url) =>
    url.endsWith("/connection-ticket")
      ? jsonResponse(200, { ticket: "tok", expires_at: "2099-01-01T00:00:00Z" })
      : jsonResponse(201, {}),
  );

  const client = new AgentClient({
    gatewayUrl: GATEWAY_URL,
    onEvent: () => {},
    onStatusChange: (status) => statuses.push(status),
    webSocketFactory: () => fake,
  });
  await client.connect();
  fake.emitOpen();
  fake.onclose?.({}); // cierre no intencional (caída del gateway)

  assert.equal(client.getStatus(), "unavailable");
  assert.ok(statuses.includes("unavailable"));
});

test("degrada a 'unavailable' sin gateway configurado (pero pide el ticket)", async (t) => {
  const { calls } = mockFetch(t, () =>
    jsonResponse(200, { ticket: "tok", expires_at: "2099-01-01T00:00:00Z" }),
  );

  const client = new AgentClient({
    gatewayUrl: null,
    onEvent: () => {},
    onStatusChange: () => {},
    webSocketFactory: () => new FakeSocket(),
  });
  await client.connect();

  assert.equal(client.getStatus(), "unavailable");
  // El ticket se solicitó igualmente (verifica B1) antes de degradar.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/v1/agent/connection-ticket");
});

test("degrada a 'unavailable' cuando falla la petición del ticket", async (t) => {
  mockFetch(t, () => jsonResponse(401, { code: "unauthorized", message: "no" }));

  const client = new AgentClient({
    gatewayUrl: GATEWAY_URL,
    onEvent: () => {},
    onStatusChange: () => {},
    webSocketFactory: () => new FakeSocket(),
  });
  await client.connect();

  assert.equal(client.getStatus(), "unavailable");
});
