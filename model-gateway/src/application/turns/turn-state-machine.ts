import { GatewayError } from "../../kernel/errors.js";
import type { TurnStatus } from "../../domain/turn.js";

const allowedTransitions: ReadonlyMap<TurnStatus, ReadonlySet<TurnStatus>> = new Map([
  ["created", new Set(["authorizing", "cancelled", "failed", "expired"])],
  ["authorizing", new Set(["running", "cancelled", "failed", "expired"])],
  ["running", new Set(["waiting_for_tool", "completed", "cancelled", "failed", "expired"])],
  ["waiting_for_tool", new Set(["resuming", "cancelled", "failed", "expired"])],
  ["resuming", new Set(["running", "cancelled", "failed", "expired"])],
  ["completed", new Set()],
  ["cancelled", new Set()],
  ["failed", new Set()],
  ["expired", new Set()]
]);

export function assertTurnTransition(from: TurnStatus, to: TurnStatus): void {
  if (!allowedTransitions.get(from)?.has(to)) {
    throw new GatewayError("INVALID_TURN_TRANSITION", `Invalid turn transition: ${from} -> ${to}`, {
      from,
      to
    });
  }
}

export function isTerminalStatus(status: TurnStatus): boolean {
  return status === "completed" || status === "cancelled" || status === "failed" || status === "expired";
}
