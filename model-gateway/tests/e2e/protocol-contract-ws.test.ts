import { afterEach, describe, expect, it } from "vitest";
import { GatewayError } from "../../src/kernel/errors.js";
import { createFakeModel } from "../../src/domain/model.js";
import { FakeControlPlaneClient } from "../../src/infrastructure/control-plane/fake-control-plane.client.js";
import { ProviderRegistry } from "../../src/providers/registry.js";
import { createTestApp, collectFrames, startMessage, type Frame, type TestApp } from "./harness.js";
import type { FastifyInstance } from "fastify";
import type { ProviderAdapter, ProviderEvent } from "../../src/ports/provider-adapter.port.js";
import type { ControlPlanePort } from "../../src/ports/control-plane.port.js";

// Secreto centinela arrendado por el control-plane fake; NUNCA debe aparecer en frames ni logs.
const LEASE_SECRET = "fake-secret";

const frameTypes = (frames: Frame[]): string[] => frames.map((frame) => frame.type as string);

/**
 * Adaptador de proveedor (protocolo "fake") que FALLA con un error de proveedor, para fijar que
 * StartTurn relaya details.providerStatus / details.providerError al frame turn.failed.
 */
function failingProviderAdapter(providerStatus: number, providerError: string): ProviderAdapter {
  return {
    protocol: "fake",
    async discoverModels() {
      return [createFakeModel()];
    },
    // eslint-disable-next-line require-yield
    async *startTurn(): AsyncIterable<ProviderEvent> {
      throw new GatewayError(
        "PROVIDER_REQUEST_FAILED",
        `Provider request failed with status ${providerStatus}: ${providerError}`,
        { providerStatus, providerError }
      );
    },
    // eslint-disable-next-line require-yield
    async *resumeTurn(): AsyncIterable<ProviderEvent> {
      throw new GatewayError("PROVIDER_REQUEST_FAILED", "unused");
    }
  };
}

/** Adaptador que emite un delta y luego "se desconecta" (lanza) a mitad del stream. */
function disconnectingProviderAdapter(): ProviderAdapter {
  return {
    protocol: "fake",
    async discoverModels() {
      return [createFakeModel()];
    },
    async *startTurn(): AsyncIterable<ProviderEvent> {
      yield { type: "text.delta", delta: "parcial" };
      throw new Error("socket hang up");
    },
    // eslint-disable-next-line require-yield
    async *resumeTurn(): AsyncIterable<ProviderEvent> {
      throw new Error("socket hang up");
    }
  };
}

/** Control-plane que autoriza pero FALLA al arrendar la credencial (no se llama al proveedor). */
function leaseFailingControlPlane(): ControlPlanePort {
  const fake = new FakeControlPlaneClient();
  return {
    authorizeTurn: (input) => fake.authorizeTurn(input),
    async leaseCredential() {
      throw new GatewayError("CREDENTIAL_LEASE_UNAVAILABLE", "No hay credencial disponible para el proveedor");
    },
    leaseCredentialForProvider: () => fake.leaseCredentialForProvider(),
    releaseCredentialLease: () => fake.releaseCredentialLease(),
    reportTurnUsage: () => fake.reportTurnUsage()
  };
}

describe("contrato del protocolo WS (fake adapter, sin proveedor real)", () => {
  let app: FastifyInstance | null = null;
  const track = (setup: TestApp): TestApp => {
    app = setup.app;
    return setup;
  };

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  // (1) HAPPY PATH: ciclo de vida completo con tool_call + resume, frames y transiciones exactas.
  it("happy path: turn.start -> stream -> tool_call -> tool_result -> resume -> completed", async () => {
    const setup = track(await createTestApp());

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
      until: (frame) => frame.type === "turn.completed"
    });

    // Secuencia EXACTA de frames del cable (lo que el frontend asume).
    expect(frameTypes(frames)).toEqual([
      "turn.started",
      "turn.text.delta",
      "turn.tool_call.ready",
      "turn.text.delta",
      "turn.text.delta",
      "turn.completed"
    ]);

    const turnId = frames[0]!.turn_id as string;
    expect(typeof turnId).toBe("string");

    // delta + snapshot del primer segmento.
    expect(frames[1]).toMatchObject({
      type: "turn.text.delta",
      turn_id: turnId,
      delta: "Encontré ",
      snapshot: "Encontré "
    });

    // tool_call.ready: relaya nombre y argumentos (el navegador es dueño de la tool).
    expect(frames[2]).toMatchObject({
      type: "turn.tool_call.ready",
      turn_id: turnId,
      tool_name: "example.list_recent_consultations",
      arguments: { limit: 3 }
    });
    expect(typeof (frames[2]!.call_id as string)).toBe("string");

    // resume: snapshot se acumula sobre el segmento del resume.
    expect(frames[3]).toMatchObject({ type: "turn.text.delta", snapshot: "1 resultado de herramienta. " });
    expect(frames[4]).toMatchObject({
      type: "turn.text.delta",
      snapshot: "1 resultado de herramienta. Turno finalizado."
    });

    // turn.completed con usage EXACTO.
    expect(frames[5]).toMatchObject({
      type: "turn.completed",
      turn_id: turnId,
      usage: { input_tokens: 24, output_tokens: 12, cached_input_tokens: 0, cache_write_tokens: 0 }
    });

    // Transiciones EXACTAS de la máquina de estados (turn-state-machine).
    expect(setup.transitions).toEqual([
      "authorizing",
      "running",
      "waiting_for_tool",
      "resuming",
      "running",
      "completed"
    ]);
    await expect(setup.container.turnStore.get(turnId)).resolves.toMatchObject({ status: "completed" });
  });

  // (2a) Error de proveedor 4xx/5xx -> turn.failed con details.providerStatus / providerError.
  it("error de proveedor (5xx) -> turn.failed con details.providerStatus y providerError", async () => {
    const setup = track(
      await createTestApp({
        mutate: (container) => {
          container.providerRegistry = new ProviderRegistry([failingProviderAdapter(503, "upstream boom")]);
        }
      })
    );

    const frames = await collectFrames({
      port: setup.port,
      cookie: setup.cookie,
      start: startMessage({ tools: [] }),
      until: (frame) => frame.type === "turn.failed"
    });

    expect(frameTypes(frames)).toEqual(["turn.started", "turn.failed"]);
    expect(frames[1]).toMatchObject({
      type: "turn.failed",
      code: "PROVIDER_REQUEST_FAILED",
      details: { providerStatus: 503, providerError: "upstream boom" }
    });
    expect(setup.transitions).toEqual(["authorizing", "running", "failed"]);

    // INVARIANTE: el log de error sólo lleva {code, turnId}; nunca el cuerpo del proveedor,
    // los argumentos ni el secreto.
    const errorLogs = setup.logs.filter((log) => log.level === "error");
    expect(errorLogs.length).toBeGreaterThan(0);
    for (const log of errorLogs) {
      expect(Object.keys(log.fields ?? {}).sort()).toEqual(["code", "turnId"]);
    }
    expect(JSON.stringify(setup.logs)).not.toContain(LEASE_SECRET);
  });

  // (2b) Fallo de arriendo de credencial -> turn.failed con el error del lease, sin llamar al proveedor.
  it("fallo de credencial (lease) -> turn.failed sin llamar al proveedor", async () => {
    const setup = track(
      await createTestApp({
        mutate: (container) => {
          container.controlPlane = leaseFailingControlPlane();
        }
      })
    );

    const frames = await collectFrames({
      port: setup.port,
      cookie: setup.cookie,
      start: startMessage({ tools: [] }),
      until: (frame) => frame.type === "turn.failed"
    });

    // El proveedor NUNCA se invoca: no hay turn.started ni deltas, sólo el fallo.
    expect(frameTypes(frames)).toEqual(["turn.failed"]);
    expect(frames[0]).toMatchObject({ type: "turn.failed", code: "CREDENTIAL_LEASE_UNAVAILABLE" });
    // El turno no llega a crearse (el lease es previo) -> sin transiciones.
    expect(setup.transitions).toEqual([]);
  });

  // (2c) Tope de tools por turno (GATEWAY_MAX_TOOLS_PER_TURN) -> rechazo.
  it("demasiadas tools -> turn.failed REQUEST_LIMIT_EXCEEDED (sin crear turno)", async () => {
    const setup = track(await createTestApp({ settings: { maxToolsPerTurn: 1 } }));

    const twoTools = [
      { name: "a", description: "", input_schema: { type: "object", additionalProperties: false }, strict: true },
      { name: "b", description: "", input_schema: { type: "object", additionalProperties: false }, strict: true }
    ];
    const frames = await collectFrames({
      port: setup.port,
      cookie: setup.cookie,
      start: startMessage({ tools: twoTools }),
      until: (frame) => frame.type === "turn.failed"
    });

    expect(frameTypes(frames)).toEqual(["turn.failed"]);
    expect(frames[0]).toMatchObject({
      type: "turn.failed",
      code: "REQUEST_LIMIT_EXCEEDED",
      details: { maxToolsPerTurn: 1 }
    });
    expect(setup.transitions).toEqual([]);
  });

  // (2d) Presupuesto de contexto excedido -> turn.failed con el error de budget.
  it("presupuesto de contexto excedido -> turn.failed CONTEXT_LIMIT_EXCEEDED", async () => {
    const setup = track(await createTestApp({ settings: { globalMaxContextTokens: 1 } }));

    const frames = await collectFrames({
      port: setup.port,
      cookie: setup.cookie,
      start: startMessage({ tools: [] }),
      until: (frame) => frame.type === "turn.failed"
    });

    expect(frameTypes(frames)).toEqual(["turn.failed"]);
    expect(frames[0]).toMatchObject({ type: "turn.failed", code: "CONTEXT_LIMIT_EXCEEDED" });
    const details = frames[0]!.details as { fits: boolean; overflowTokens: number };
    expect(details.fits).toBe(false);
    expect(details.overflowTokens).toBeGreaterThan(0);
    // El budget se evalúa antes de crear el turno.
    expect(setup.transitions).toEqual([]);
  });

  // (2e) Cancelación a mitad de turno -> cancelación limpia y transición válida.
  it("cancelación (agent.cancel_turn) a mitad de turno -> turn.cancelled limpio", async () => {
    const setup = track(await createTestApp());

    let cancelTurnId = "";
    const frames = await collectFrames({
      port: setup.port,
      cookie: setup.cookie,
      start: startMessage(),
      onFrame: (frame, ws) => {
        if (frame.type === "turn.tool_call.ready") {
          cancelTurnId = frame.turn_id as string;
          ws.send(JSON.stringify({ type: "agent.cancel_turn", request_id: "cancel_1", turn_id: cancelTurnId }));
        }
      },
      until: (frame) => frame.type === "agent.cancel_turn.result"
    });

    expect(frames).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "turn.cancelled", turn_id: cancelTurnId }),
        expect.objectContaining({ type: "agent.cancel_turn.result", cancelled_turn_ids: [cancelTurnId] })
      ])
    );
    expect(setup.transitions).toContain("cancelled");
    await expect(setup.container.turnStore.get(cancelTurnId)).resolves.toMatchObject({ status: "cancelled" });
  });

  // (2f) Desconexión inesperada del proveedor a mitad de stream -> turn.failed limpio (sin colgarse).
  it("desconexión del proveedor a mitad de stream -> turn.failed limpio", async () => {
    const setup = track(
      await createTestApp({
        mutate: (container) => {
          container.providerRegistry = new ProviderRegistry([disconnectingProviderAdapter()]);
        }
      })
    );

    const frames = await collectFrames({
      port: setup.port,
      cookie: setup.cookie,
      start: startMessage({ tools: [] }),
      until: (frame) => frame.type === "turn.failed"
    });

    expect(frameTypes(frames)).toEqual(["turn.started", "turn.text.delta", "turn.failed"]);
    expect(frames[1]).toMatchObject({ type: "turn.text.delta", delta: "parcial" });
    expect(frames[2]).toMatchObject({ type: "turn.failed", code: "INTERNAL_ERROR", message: "socket hang up" });
    expect(setup.transitions).toEqual(["authorizing", "running", "failed"]);
  });

  // (3) INVARIANTES: ningún secreto en los frames; los args se relayan pero no se loguean.
  it("invariantes: sin secretos en frames; args relayados pero no logueados", async () => {
    const setup = track(await createTestApp());

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
              result: { status: "success", content: {} }
            })
          );
        }
      },
      until: (frame) => frame.type === "turn.completed"
    });

    // El secreto arrendado NUNCA viaja al cliente.
    expect(JSON.stringify(frames)).not.toContain(LEASE_SECRET);
    // Los argumentos SÍ se relayan al cliente (el navegador ejecuta la tool).
    const toolCall = frames.find((frame) => frame.type === "turn.tool_call.ready");
    expect(toolCall?.arguments).toEqual({ limit: 3 });

    // Pero NUNCA se loguean ni el secreto, ni el prompt, ni los argumentos de la tool.
    const logsJson = JSON.stringify(setup.logs);
    expect(logsJson).not.toContain(LEASE_SECRET);
    expect(logsJson).not.toContain("Resume."); // prompt del usuario
    expect(logsJson).not.toContain("limit"); // argumento de la tool
  });
});
