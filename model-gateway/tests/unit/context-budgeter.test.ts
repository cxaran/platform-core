import { describe, expect, it } from "vitest";
import { ContextBudgeter } from "../../src/domain/context-budget.js";
import { createFakeModel } from "../../src/domain/model.js";

describe("context budgeter", () => {
  it("rejects context outside the effective budget", () => {
    const result = new ContextBudgeter().assess({
      model: createFakeModel({
        capabilities: { ...createFakeModel().capabilities, contextWindowTokens: 128000 }
      }),
      requestedMaxOutputTokens: 4000,
      profileMaxInputTokens: null,
      gatewayGlobalMaxContextTokens: 128000,
      estimatedMessageTokens: 158000,
      estimatedToolSchemaTokens: 0,
      estimatedSystemTokens: 0,
      safetyReserveTokens: 1024
    });

    expect(result.fits).toBe(false);
    expect(result.overflowTokens).toBeGreaterThan(0);
  });
});
