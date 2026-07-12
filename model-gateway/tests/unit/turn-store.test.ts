import { describe, expect, it } from "vitest";
import { createFakeModel } from "../../src/domain/model.js";
import { InMemoryTurnStore } from "../../src/infrastructure/turn-store/in-memory-turn-store.js";
import type { TurnAuthorization } from "../../src/ports/control-plane.port.js";

const authorization: TurnAuthorization = {
  userId: "u1",
  sessionId: "bs_1",
  tenantId: null,
  profileId: "profile_1",
  providerId: "fake",
  credentialId: "credential_1",
  modelId: "fake-model",
  allowedCapabilities: {
    tools: true,
    structuredOutput: true,
    reasoning: false,
    images: false,
    audio: false
  },
  limits: {
    maxConcurrentTurns: 1,
    maxInputTokens: null,
    maxOutputTokens: 4096,
    maxTurnDurationSeconds: 60,
    maxToolResultBytes: 1024
  }
};

describe("in-memory turn store", () => {
  it("rejects tool_result without a pending tool_call", async () => {
    const store = new InMemoryTurnStore();
    const turn = await store.create({ browserSessionId: "bs_1", authorization, model: createFakeModel() });

    await expect(
      store.consumeToolResult(turn.id, { callId: "missing", result: { status: "success", content: {} } })
    ).rejects.toMatchObject({ code: "UNKNOWN_TOOL_CALL" });
  });

  it("rejects duplicated tool_result", async () => {
    const store = new InMemoryTurnStore();
    const turn = await store.create({ browserSessionId: "bs_1", authorization, model: createFakeModel() });

    await store.addPendingToolCall(turn.id, { callId: "call_1", name: "tool", arguments: {} });
    await store.consumeToolResult(turn.id, { callId: "call_1", result: { status: "success", content: {} } });

    await expect(
      store.consumeToolResult(turn.id, { callId: "call_1", result: { status: "success", content: {} } })
    ).rejects.toMatchObject({ code: "UNKNOWN_TOOL_CALL" });
  });

  it("cancels active turns when a browser session closes", async () => {
    const store = new InMemoryTurnStore();
    const turn = await store.create({ browserSessionId: "bs_1", authorization, model: createFakeModel() });
    await store.transition(turn.id, "authorizing");
    await store.transition(turn.id, "running");

    const cancelled = await store.cancelByBrowserSession("bs_1");

    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]?.status).toBe("cancelled");
  });
});
