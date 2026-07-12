import { describe, expect, it } from "vitest";
import { redactValue } from "../../src/kernel/redact.js";

describe("redactValue", () => {
  it("never leaves secrets in logger payloads", () => {
    const redacted = redactValue({
      apiKey: "sk-real",
      nested: {
        authorization: "Bearer secret",
        safe: "visible"
      }
    });

    expect(JSON.stringify(redacted)).not.toContain("sk-real");
    expect(JSON.stringify(redacted)).not.toContain("Bearer secret");
    expect(JSON.stringify(redacted)).toContain("visible");
  });
});
