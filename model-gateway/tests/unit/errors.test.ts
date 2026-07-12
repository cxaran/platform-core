import { describe, expect, it } from "vitest";
import { GatewayError, toGatewayError } from "../../src/kernel/errors.js";

describe("GatewayError", () => {
  it("expone code, message, details y name", () => {
    const error = new GatewayError("BUDGET_EXCEEDED", "Presupuesto superado", { limit: 100 });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("GatewayError");
    expect(error.code).toBe("BUDGET_EXCEEDED");
    expect(error.message).toBe("Presupuesto superado");
    expect(error.details).toEqual({ limit: 100 });
  });

  it("details es opcional (undefined por defecto)", () => {
    const error = new GatewayError("X", "msg");
    expect(error.details).toBeUndefined();
  });
});

describe("toGatewayError", () => {
  it("devuelve el mismo GatewayError sin envolver", () => {
    const original = new GatewayError("PROTOCOL_ERROR", "frame inválido");
    expect(toGatewayError(original)).toBe(original);
  });

  it("envuelve un Error genérico como INTERNAL_ERROR conservando el message", () => {
    const result = toGatewayError(new Error("boom"));
    expect(result).toBeInstanceOf(GatewayError);
    expect(result.code).toBe("INTERNAL_ERROR");
    expect(result.message).toBe("boom");
  });

  it("convierte un valor no-Error en INTERNAL_ERROR con mensaje genérico", () => {
    for (const value of ["string crudo", 42, null, undefined, { a: 1 }]) {
      const result = toGatewayError(value);
      expect(result).toBeInstanceOf(GatewayError);
      expect(result.code).toBe("INTERNAL_ERROR");
      expect(result.message).toBe("Unexpected gateway error");
    }
  });
});
