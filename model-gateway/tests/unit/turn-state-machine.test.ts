import { describe, expect, it } from "vitest";
import { assertTurnTransition } from "../../src/application/turns/turn-state-machine.js";

describe("turn state machine", () => {
  it("rejects invalid transitions", () => {
    expect(() => assertTurnTransition("completed", "running")).toThrow("Invalid turn transition");
  });
});
