import assert from "node:assert/strict";
import { test } from "node:test";

import {
  backoffDelay,
  DEFAULT_RECONNECT_CONFIG,
  initialReconnectState,
  reduceReconnect,
  type ReconnectConfig,
  type ReconnectEvent,
  type ReconnectState,
} from "@/core/agent/reconnect-machine";

function run(events: ReconnectEvent[], config?: ReconnectConfig): ReconnectState {
  return events.reduce(
    (state, event) => reduceReconnect(state, event, config ?? DEFAULT_RECONNECT_CONFIG),
    initialReconnectState(),
  );
}

test("happy path: connect_start → connecting → connected (sin intentos)", () => {
  const s1 = reduceReconnect(initialReconnectState(), { type: "connect_start" });
  assert.equal(s1.phase, "connecting");
  assert.equal(s1.attempts, 0);
  const s2 = reduceReconnect(s1, { type: "connected" });
  assert.equal(s2.phase, "connected");
  assert.equal(s2.attempts, 0);
  assert.equal(s2.nextDelayMs, null);
});

test("caída → reconnecting (con backoff) → retry → connected reinicia el contador", () => {
  const connected = run([{ type: "connect_start" }, { type: "connected" }]);
  const dropped = reduceReconnect(connected, { type: "dropped" });
  assert.equal(dropped.phase, "reconnecting");
  assert.equal(dropped.attempts, 1);
  assert.equal(dropped.nextDelayMs, 1000); // baseDelayMs

  const retrying = reduceReconnect(dropped, { type: "retry" });
  assert.equal(retrying.phase, "connecting");
  assert.equal(retrying.attempts, 1); // conserva el contador durante el intento

  const reconnected = reduceReconnect(retrying, { type: "connected" });
  assert.equal(reconnected.phase, "connected");
  assert.equal(reconnected.attempts, 0); // reinicia el backoff
});

test("fallos repetidos: el backoff crece y se agota en el tope → failed", () => {
  let state = run([{ type: "connect_start" }, { type: "connected" }]);
  const delays: (number | null)[] = [];
  // maxAttempts=5: 4 esperas de backoff (attempts 1..4) y el 5º dropped → failed.
  for (let i = 0; i < 5; i += 1) {
    state = reduceReconnect(state, { type: "dropped" });
    delays.push(state.nextDelayMs);
    if (state.phase === "reconnecting") {
      state = reduceReconnect(state, { type: "retry" });
    }
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, null]);
  assert.equal(state.phase, "failed");
  assert.equal(state.attempts, 5);
  assert.equal(state.nextDelayMs, null);
});

test("el backoff se ACOTA a maxDelayMs", () => {
  // Directo: attempt grande → tope.
  assert.equal(backoffDelay(1), 1000);
  assert.equal(backoffDelay(4), 8000);
  assert.equal(backoffDelay(5), 15000); // 16000 acotado a 15000
  assert.equal(backoffDelay(10), 15000);
  // En el flujo, con un tope de intentos alto, la espera nunca supera maxDelayMs.
  const config: ReconnectConfig = { ...DEFAULT_RECONNECT_CONFIG, maxAttempts: 12 };
  let state = run([{ type: "connect_start" }, { type: "connected" }], config);
  let maxSeen = 0;
  for (let i = 0; i < 8; i += 1) {
    state = reduceReconnect(state, { type: "dropped" }, config);
    if (state.nextDelayMs != null) {
      maxSeen = Math.max(maxSeen, state.nextDelayMs);
    }
    if (state.phase === "reconnecting") {
      state = reduceReconnect(state, { type: "retry" }, config);
    }
  }
  assert.equal(maxSeen, config.maxDelayMs);
});

test("reintento MANUAL desde failed reinicia el backoff y vuelve a connecting", () => {
  let state = run([{ type: "connect_start" }, { type: "connected" }]);
  for (let i = 0; i < 5; i += 1) {
    state = reduceReconnect(state, { type: "dropped" });
    if (state.phase === "reconnecting") {
      state = reduceReconnect(state, { type: "retry" });
    }
  }
  assert.equal(state.phase, "failed");
  const manual = reduceReconnect(state, { type: "manual_retry" });
  assert.equal(manual.phase, "connecting");
  assert.equal(manual.attempts, 0);
  assert.equal(manual.nextDelayMs, null);
});

test("manual_retry sólo aplica desde failed (no-op en otras fases)", () => {
  const connected = run([{ type: "connect_start" }, { type: "connected" }]);
  assert.deepEqual(reduceReconnect(connected, { type: "manual_retry" }), connected);
});

test("dispose es TERMINAL para eventos de reconexión: un cierre intencional NO dispara reconexión", () => {
  const connected = run([{ type: "connect_start" }, { type: "connected" }]);
  const disposed = reduceReconnect(connected, { type: "dispose" });
  assert.equal(disposed.phase, "disposed");
  // Los eventos de RECONEXIÓN se ignoran: nunca vuelve a reconnecting/connecting por su cuenta.
  for (const event of [{ type: "dropped" }, { type: "retry" }, { type: "manual_retry" }] as const) {
    assert.equal(reduceReconnect(disposed, event).phase, "disposed");
  }
});

test("connect_start RESUCITA desde disposed: un remonte legítimo (StrictMode/reabrir chat) reconecta", () => {
  const connected = run([{ type: "connect_start" }, { type: "connected" }]);
  const disposed = reduceReconnect(connected, { type: "dispose" });
  assert.equal(disposed.phase, "disposed");
  // El nuevo montaje del panel dispara connect_start y DEBE arrancar un ciclo de conexión limpio.
  const revived = reduceReconnect(disposed, { type: "connect_start" });
  assert.equal(revived.phase, "connecting");
  assert.equal(revived.attempts, 0);
});

test("retry fuera de reconnecting es no-op (no salta intentos)", () => {
  const connected = run([{ type: "connect_start" }, { type: "connected" }]);
  assert.deepEqual(reduceReconnect(connected, { type: "retry" }), connected);
});
