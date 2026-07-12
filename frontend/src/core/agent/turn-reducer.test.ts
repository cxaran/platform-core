import assert from "node:assert/strict";
import { test } from "node:test";

import {
  failInFlightTurn,
  initialTurnState,
  reduceTurnEvent,
  type TurnState,
} from "@/core/agent/turn-reducer";

const INTERRUPTED = "Se interrumpió la conexión.";

function runningTurn(): TurnState {
  return reduceTurnEvent(initialTurnState(), { type: "turn.started", turn_id: "t1" });
}

test("failInFlightTurn: un turno en curso (running) se marca failed con CONNECTION_LOST", () => {
  const running = runningTurn();
  assert.equal(running.status, "running");
  const failed = failInFlightTurn(running, INTERRUPTED);
  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.error, { code: "CONNECTION_LOST", message: INTERRUPTED });
});

test("failInFlightTurn: un turno esperando tool (waiting_for_tool) también se falla", () => {
  const waiting = reduceTurnEvent(runningTurn(), {
    type: "turn.tool_call.ready",
    turn_id: "t1",
    call_id: "c1",
    tool_name: "read_x",
    arguments: {},
  });
  assert.equal(waiting.status, "waiting_for_tool");
  assert.equal(failInFlightTurn(waiting, INTERRUPTED).status, "failed");
});

test("failInFlightTurn: estados NO activos quedan intactos (idempotente)", () => {
  const idle = initialTurnState();
  assert.equal(failInFlightTurn(idle, INTERRUPTED), idle);
  const completed = reduceTurnEvent(runningTurn(), {
    type: "turn.completed",
    turn_id: "t1",
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cached_input_tokens: null,
      cache_write_tokens: null,
    },
  });
  assert.equal(completed.status, "completed");
  assert.equal(failInFlightTurn(completed, INTERRUPTED), completed);
  // Un turno ya fallado no se altera (no se duplica el error de conexión).
  const alreadyFailed = failInFlightTurn(runningTurn(), "primero");
  assert.equal(failInFlightTurn(alreadyFailed, "segundo"), alreadyFailed);
});
