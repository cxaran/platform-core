import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";

import { createTestApp, collectFrames, startMessage, type Frame } from "./harness.js";
import type { BackendSessionValidatorPort } from "../../src/ports/backend-session.port.js";

// Gate de SESIÓN DEL BACKEND en el WS del gateway: cuando hay validador configurado, ningún turno
// del modelo corre sin una sesión del backend viva (cierra el hueco por el que el agente respondía
// aunque la sesión del usuario estuviera muerta). En dev/tests sin validador queda desactivado.

describe("gate de sesión del backend", () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it("rechaza el turno y avisa cuando la sesión del backend NO es válida", async () => {
    const invalid: BackendSessionValidatorPort = { validate: async () => null };
    const setup = await createTestApp({ mutate: (c) => (c.backendSession = invalid) });
    app = setup.app;

    const frames = await collectFrames({
      port: setup.port,
      cookie: setup.cookie,
      start: startMessage(),
      until: (f: Frame) => f.type === "protocol.error"
    });

    const error = frames.find((f) => f.type === "protocol.error");
    expect(error?.code).toBe("BACKEND_SESSION_EXPIRED");
    // No debe haberse iniciado ningún turno.
    expect(frames.some((f) => f.type === "turn.started" || f.type === "turn.text.delta")).toBe(false);
  });

  it("deja correr el turno cuando la sesión del backend está viva y es del mismo usuario", async () => {
    // El dev-ticket del harness crea la sesión del gateway con userId "dev-user".
    const valid: BackendSessionValidatorPort = { validate: async () => ({ userId: "dev-user" }) };
    const setup = await createTestApp({ mutate: (c) => (c.backendSession = valid) });
    app = setup.app;

    const frames = await collectFrames({
      port: setup.port,
      cookie: setup.cookie,
      start: startMessage(),
      onFrame: (frame, ws) => {
        if (frame.type === "turn.tool_call.ready") {
          ws.send(
            JSON.stringify({
              type: "turn.tool_result",
              turn_id: frame.turn_id,
              call_id: frame.call_id,
              result: { status: "success", content: { consultations: [] } }
            })
          );
        }
      },
      until: (f: Frame) => f.type === "turn.completed"
    });

    expect(frames.some((f) => f.type === "turn.completed")).toBe(true);
    expect(frames.some((f) => f.code === "BACKEND_SESSION_EXPIRED")).toBe(false);
  });
});
