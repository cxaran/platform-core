import { describe, expect, it } from "vitest";
import { parseClientMessage } from "../../src/transport/websocket/protocol.parser.js";

describe("parseClientMessage: RPC de catálogo y control (B6)", () => {
  it("parsea models.list con view por defecto", () => {
    const parsed = parseClientMessage({ type: "models.list", request_id: "r1" });
    expect(parsed).toEqual({ kind: "models.list", requestId: "r1", view: "default" });
  });

  it("parsea models.list con view explícita", () => {
    const parsed = parseClientMessage({ type: "models.list", request_id: "r1", view: "default" });
    expect(parsed).toEqual({ kind: "models.list", requestId: "r1", view: "default" });
  });

  it("rechaza models.list sin request_id", () => {
    expect(() => parseClientMessage({ type: "models.list" })).toThrow();
  });

  it("rechaza models.list con view inválida", () => {
    expect(() => parseClientMessage({ type: "models.list", request_id: "r1", view: "all" })).toThrow();
  });

  it("parsea provider.status", () => {
    const parsed = parseClientMessage({ type: "provider.status", request_id: "r2" });
    expect(parsed).toEqual({ kind: "provider.status", requestId: "r2" });
  });

  it("parsea agent.cancel_turn con turn_id", () => {
    const parsed = parseClientMessage({ type: "agent.cancel_turn", request_id: "r3", turn_id: "t1" });
    expect(parsed).toEqual({ kind: "agent.cancel_turn", requestId: "r3", turnId: "t1" });
  });

  it("parsea agent.cancel_turn sin turn_id (omite la clave)", () => {
    const parsed = parseClientMessage({ type: "agent.cancel_turn", request_id: "r3" });
    expect(parsed).toEqual({ kind: "agent.cancel_turn", requestId: "r3" });
    if (parsed.kind !== "agent.cancel_turn") throw new Error("esperado agent.cancel_turn");
    expect("turnId" in parsed).toBe(false);
  });

  it("sigue rechazando turn.cancel como tipo desconocido (no rompe el contrato previo)", () => {
    expect(() => parseClientMessage({ type: "turn.cancel" })).toThrow("Unknown WebSocket message type");
  });
});
