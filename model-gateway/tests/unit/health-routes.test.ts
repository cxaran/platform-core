import { describe, expect, it } from "vitest";
import { createContainer } from "../../src/bootstrap/container.js";
import { buildApp } from "../../src/transport/http/app.js";

describe("health routes", () => {
  it("responds to the Docker healthcheck endpoint", async () => {
    const app = await buildApp(createContainer());

    try {
      const response = await app.inject({ method: "GET", url: "/healthz" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ok" });
    } finally {
      await app.close();
    }
  });

  it("marks metrics as an internal observability endpoint", async () => {
    const app = await buildApp(createContainer());

    try {
      const response = await app.inject({ method: "GET", url: "/metrics" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["x-internal-observability"]).toBe("true");
    } finally {
      await app.close();
    }
  });
});
