import WebSocket from "ws";
import { expect } from "vitest";
import { createContainer } from "../../src/bootstrap/container.js";
import { buildApp } from "../../src/transport/http/app.js";
import { InMemoryTurnStore } from "../../src/infrastructure/turn-store/in-memory-turn-store.js";
import type { FastifyInstance } from "fastify";
import type { GatewayContainer } from "../../src/bootstrap/container.js";
import type { GatewaySettings } from "../../src/config/settings.js";
import type { TurnStorePort, CreateTurnInput } from "../../src/ports/turn-store.port.js";
import type { ModelTurn, TurnStatus } from "../../src/domain/turn.js";
import type { ToolCallRequest, ToolCallResult } from "../../src/domain/tool.js";

/**
 * Harness e2e compartido para fijar el CONTRATO del protocolo WS contra el adaptador fake
 * (sin proveedor ni credenciales reales). Reúne lo que ya hacía ``fake-provider-ws.test.ts``
 * (settings base, sesión, levantar el server) y añade dos costuras de test:
 *  - telemetría que GRABA (para verificar que no se loguean secretos/args), y
 *  - un turn-store que GRABA la secuencia de transiciones (para fijar la máquina de estados).
 * Permite mutar el container antes de ``buildApp`` (inyectar adaptadores de fallo).
 */

export const baseSettings: GatewaySettings = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 0,
  publicPathPrefix: "/model-gateway",
  enableRootPathAlias: true,
  cookieName: "mg_session",
  allowedOrigins: ["http://localhost:3000"],
  globalMaxContextTokens: 128000,
  safetyReserveTokens: 1024,
  maxWebSocketMessageBytes: 1024 * 1024,
  maxToolsPerTurn: 16,
  maxToolResultBytes: 64 * 1024,
  toolResultTimeoutMs: 1000,
  devTicket: "test-ticket",
  agentTicketSecret: "",
  opencodeBaseUrl: "https://opencode.test/v1",
  opencodeDefaultModel: "test-model",
  fakeEnabled: true
};

export interface RecordedLog {
  level: "info" | "warn" | "error";
  message: string;
  fields?: Record<string, unknown>;
}

/** Turn-store que delega en el real y GRABA la secuencia de transiciones (estado destino). */
class RecordingTurnStore implements TurnStorePort {
  constructor(
    private readonly inner: TurnStorePort,
    readonly transitions: TurnStatus[]
  ) {}
  create(input: CreateTurnInput): Promise<ModelTurn> {
    return this.inner.create(input);
  }
  get(turnId: string): Promise<ModelTurn | null> {
    return this.inner.get(turnId);
  }
  transition(turnId: string, status: TurnStatus): Promise<ModelTurn> {
    this.transitions.push(status);
    return this.inner.transition(turnId, status);
  }
  addPendingToolCall(turnId: string, call: ToolCallRequest): Promise<ModelTurn> {
    return this.inner.addPendingToolCall(turnId, call);
  }
  consumeToolResult(turnId: string, result: ToolCallResult): Promise<{ turn: ModelTurn; call: ToolCallRequest }> {
    return this.inner.consumeToolResult(turnId, result);
  }
  setContinuationState(turnId: string, continuationState: unknown | null): Promise<ModelTurn> {
    return this.inner.setContinuationState(turnId, continuationState);
  }
  setUsage(turnId: string, usage: ModelTurn["usage"]): Promise<ModelTurn> {
    return this.inner.setUsage(turnId, usage);
  }
  cancel(turnId: string): Promise<ModelTurn> {
    this.transitions.push("cancelled");
    return this.inner.cancel(turnId);
  }
  cancelByBrowserSession(browserSessionId: string): Promise<ModelTurn[]> {
    return this.inner.cancelByBrowserSession(browserSessionId);
  }
}

export interface TestApp {
  app: FastifyInstance;
  container: GatewayContainer;
  port: number;
  cookie: string;
  /** Todo lo que la telemetría registró (para verificar ausencia de secretos/args). */
  logs: RecordedLog[];
  /** Secuencia de transiciones del turn-store (para fijar la máquina de estados). */
  transitions: TurnStatus[];
}

export interface CreateTestAppOptions {
  settings?: Partial<GatewaySettings>;
  /** Muta el container antes de ``buildApp`` (inyectar control-plane/registry de fallo). */
  mutate?: (container: GatewayContainer) => void;
}

async function listen(app: FastifyInstance): Promise<number> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }
  return address.port;
}

async function createSession(app: FastifyInstance): Promise<string> {
  const sessionResponse = await app.inject({
    method: "POST",
    url: "/model-gateway/v1/browser-sessions",
    payload: { ticket: "test-ticket" }
  });
  const cookie = sessionResponse.headers["set-cookie"];
  if (!cookie) {
    throw new Error("Expected gateway session cookie");
  }
  if (Array.isArray(cookie)) {
    const first = cookie[0];
    if (!first) {
      throw new Error("Expected gateway session cookie value");
    }
    return first;
  }
  return cookie;
}

export async function createTestApp(options: CreateTestAppOptions = {}): Promise<TestApp> {
  const container = createContainer({ ...baseSettings, ...options.settings });

  const logs: RecordedLog[] = [];
  // Sólo se incluye ``fields`` cuando viene (exactOptionalPropertyTypes).
  const record = (level: RecordedLog["level"], message: string, fields?: Record<string, unknown>): void => {
    logs.push(fields ? { level, message, fields } : { level, message });
  };
  container.telemetry = {
    info: (message, fields) => record("info", message, fields),
    warn: (message, fields) => record("warn", message, fields),
    error: (message, fields) => record("error", message, fields)
  };

  const transitions: TurnStatus[] = [];
  container.turnStore = new RecordingTurnStore(container.turnStore, transitions);

  options.mutate?.(container);

  const app = await buildApp(container);
  const health = await app.inject({ method: "GET", url: "/healthz" });
  expect(health.statusCode).toBe(200);
  const cookie = await createSession(app);
  const port = await listen(app);
  return { app, container, port, cookie, logs, transitions };
}

export type Frame = Record<string, unknown>;

export interface CollectOptions {
  port: number;
  cookie: string;
  /** Mensaje a enviar al abrir el socket (normalmente ``turn.start``). */
  start?: unknown;
  /** Reacción por frame (p. ej. responder un tool_result o enviar agent.cancel_turn). */
  onFrame?: (frame: Frame, ws: WebSocket) => void;
  /** Resuelve la promesa (y cierra el socket) cuando devuelve true para un frame. */
  until: (frame: Frame) => boolean;
  timeoutMs?: number;
}

/** Abre el WS, envía ``start`` y acumula frames hasta que ``until`` se cumple. */
export function collectFrames(options: CollectOptions): Promise<Frame[]> {
  return new Promise<Frame[]>((resolve, reject) => {
    const frames: Frame[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${options.port}/model-gateway/v1/ws`, {
      headers: { Cookie: options.cookie }
    });

    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Timed out waiting for websocket frames"));
    }, options.timeoutMs ?? 3000);
    timer.unref();

    ws.on("open", () => {
      if (options.start !== undefined) {
        ws.send(JSON.stringify(options.start));
      }
    });
    ws.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as Frame;
      frames.push(frame);
      options.onFrame?.(frame, ws);
      if (options.until(frame)) {
        clearTimeout(timer);
        ws.close();
        resolve(frames);
      }
    });
    ws.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Mensaje ``turn.start`` con un tool (igual forma que el cliente del navegador). */
export function startMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "turn.start",
    request_id: "req_1",
    profile_id: "profile_example_assistant",
    messages: [{ role: "user", content: [{ type: "text", text: "Resume." }] }],
    tools: [
      {
        name: "example.list_recent_consultations",
        description: "Lists recent consultations",
        input_schema: { type: "object", additionalProperties: false },
        strict: true
      }
    ],
    generation: { max_output_tokens: 1200, temperature: 0.2 },
    ...overrides
  };
}
