import { describe, expect, it } from "vitest";
import { createId } from "../../src/kernel/ids.js";

describe("createId", () => {
  it("usa el prefijo declarado seguido de '_' y 32 hex sin guiones", () => {
    for (const prefix of ["bs", "turn", "call", "lease", "req"] as const) {
      const id = createId(prefix);
      expect(id.startsWith(`${prefix}_`)).toBe(true);
      const suffix = id.slice(prefix.length + 1);
      expect(suffix).toMatch(/^[0-9a-f]{32}$/); // uuid v4 sin guiones
      expect(id.includes("-")).toBe(false);
    }
  });

  it("genera identificadores únicos en llamadas sucesivas", () => {
    const ids = new Set(Array.from({ length: 100 }, () => createId("turn")));
    expect(ids.size).toBe(100);
  });
});
