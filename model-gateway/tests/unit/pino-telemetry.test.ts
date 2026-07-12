import { describe, expect, it } from "vitest";
import { PinoTelemetry } from "../../src/infrastructure/observability/pino-telemetry.js";

describe("PinoTelemetry", () => {
  it("redacts secrets before writing logs", () => {
    const writes: unknown[] = [];
    const logger = {
      info(fields: unknown) {
        writes.push(fields);
      },
      warn(fields: unknown) {
        writes.push(fields);
      },
      error(fields: unknown) {
        writes.push(fields);
      }
    };

    const telemetry = new PinoTelemetry(logger as never);
    telemetry.error("failed", {
      authorization: "Bearer secret",
      cookie: "mg_session=secret",
      apiKey: "sk-secret",
      nested: { safe: "visible", credential: "credential-secret" }
    });

    const serialized = JSON.stringify(writes);
    expect(serialized).not.toContain("Bearer secret");
    expect(serialized).not.toContain("mg_session=secret");
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("credential-secret");
    expect(serialized).toContain("visible");
  });
});
