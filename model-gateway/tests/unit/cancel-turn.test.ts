import { describe, expect, it } from "vitest";
import { CancelTurn } from "../../src/application/turns/cancel-turn.js";
import { InMemoryTurnStore } from "../../src/infrastructure/turn-store/in-memory-turn-store.js";
import { GatewayError } from "../../src/kernel/errors.js";
import type { TurnEvent, TurnEventSink } from "../../src/application/turns/start-turn.js";
import type { BrowserSession } from "../../src/domain/gateway-session.js";
import type { TurnAuthorization } from "../../src/ports/control-plane.port.js";
import type { ModelDescriptor } from "../../src/domain/model.js";
import { createFakeModel } from "../../src/domain/model.js";

const telemetry = { info() {}, warn() {}, error() {} };

function session(id = "bs_1"): BrowserSession {
  return {
    id,
    userId: "user_1",
    sessionRef: "ref_1",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000)
  };
}

function authorization(): TurnAuthorization {
  return {
    userId: "user_1",
    sessionId: "bs_1",
    tenantId: null,
    profileId: "profile",
    providerId: "fake",
    credentialId: "user_1",
    modelId: "fake-model",
    allowedCapabilities: { tools: true, structuredOutput: true, reasoning: false, images: false, audio: false },
    limits: {
      maxConcurrentTurns: 2,
      maxInputTokens: null,
      maxOutputTokens: 4096,
      maxTurnDurationSeconds: 60,
      maxToolResultBytes: 64 * 1024
    }
  };
}

const model: ModelDescriptor = createFakeModel();

function sink(): TurnEventSink & { events: TurnEvent[] } {
  const events: TurnEvent[] = [];
  return {
    events,
    async emit(event) {
      events.push(event);
    }
  };
}

async function seedRunningTurn(store: InMemoryTurnStore, browserSessionId = "bs_1") {
  const auth = { ...authorization(), sessionId: browserSessionId };
  const turn = await store.create({ browserSessionId, authorization: auth, model });
  await store.transition(turn.id, "authorizing");
  await store.transition(turn.id, "running");
  await store.transition(turn.id, "waiting_for_tool");
  await store.addPendingToolCall(turn.id, { callId: "call_1", name: "example.x", arguments: {} });
  return turn;
}

describe("CancelTurn", () => {
  it("cancela un turn en waiting_for_tool y limpia pending tool calls", async () => {
    const store = new InMemoryTurnStore();
    const turn = await seedRunningTurn(store);
    const cancel = new CancelTurn({ turnStore: store, telemetry });
    const out = sink();

    const ids = await cancel.execute(session(), { turnId: turn.id }, out);

    expect(ids).toEqual([turn.id]);
    const after = await store.get(turn.id);
    expect(after?.status).toBe("cancelled");
    expect(after?.pendingToolCalls.size).toBe(0);
    expect(out.events).toEqual([{ type: "turn.cancelled", turn_id: turn.id }]);
  });

  it("cancela el turn activo de la sesión cuando no se da turn_id", async () => {
    const store = new InMemoryTurnStore();
    const turn = await seedRunningTurn(store);
    const cancel = new CancelTurn({ turnStore: store, telemetry });
    const out = sink();

    const ids = await cancel.execute(session(), {}, out);

    expect(ids).toEqual([turn.id]);
    expect((await store.get(turn.id))?.status).toBe("cancelled");
  });

  it("falla con NO_ACTIVE_TURN si no hay turn activo", async () => {
    const store = new InMemoryTurnStore();
    const cancel = new CancelTurn({ turnStore: store, telemetry });
    await expect(cancel.execute(session(), {}, sink())).rejects.toMatchObject({
      code: "NO_ACTIVE_TURN"
    });
  });

  it("falla con TURN_NOT_FOUND si el turn es de otra sesión", async () => {
    const store = new InMemoryTurnStore();
    const turn = await seedRunningTurn(store, "bs_otra");
    const cancel = new CancelTurn({ turnStore: store, telemetry });
    await expect(
      cancel.execute(session("bs_1"), { turnId: turn.id }, sink())
    ).rejects.toBeInstanceOf(GatewayError);
  });

  it("falla con TURN_NOT_CANCELLABLE si el turn ya está cancelado", async () => {
    const store = new InMemoryTurnStore();
    const turn = await seedRunningTurn(store);
    await store.cancel(turn.id);
    const cancel = new CancelTurn({ turnStore: store, telemetry });
    await expect(
      cancel.execute(session(), { turnId: turn.id }, sink())
    ).rejects.toMatchObject({ code: "TURN_NOT_CANCELLABLE" });
  });
});
