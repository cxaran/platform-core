import { browserApi } from "@/core/api/browser-client";

import type {
  ClientMessage,
  ConnectionTicketResponse,
  ServerEvent,
  ToolResultPayload,
  WireGeneration,
  WireMessage,
  WireTool,
} from "./protocol";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "unavailable";

// Forma mínima del WebSocket inyectable (el WebSocket nativo del navegador la cumple
// estructuralmente). Permite mockear el WS en tests sin DOM.
export interface GatewaySocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type WebSocketFactory = (url: string) => GatewaySocketLike;

const DEFAULT_TICKET_PATH = "/api/v1/agent/connection-ticket";

export interface AgentClientOptions {
  // Base del gateway incluyendo prefijo público (p.ej. http://host:8081/model-gateway).
  // null/'' => no configurado: el cliente degrada a 'unavailable' sin crashear.
  gatewayUrl: string | null;
  onEvent: (event: ServerEvent) => void;
  onStatusChange: (status: ConnectionStatus) => void;
  ticketPath?: string;
  // Inyectables para tests; por defecto el WebSocket nativo del navegador.
  webSocketFactory?: WebSocketFactory;
}

export interface StartTurnInput {
  profileId: string;
  messages: WireMessage[];
  tools?: WireTool[];
  generation: WireGeneration;
}

function toWebSocketUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  const wsBase = trimmed.replace(/^http/u, "ws"); // http->ws, https->wss
  return `${wsBase}/v1/ws`;
}

/**
 * Cliente del agente (B7): maneja el handshake ticket -> browser-session -> WebSocket
 * contra el model-gateway y expone el envío de mensajes tipados + un stream de eventos.
 *
 * Degradación: si el gateway no está configurado o cualquier paso falla, pasa a
 * 'unavailable' sin lanzar (la UI muestra 'Gateway no disponible'). El ticket es de un
 * solo uso y corto: se manda al gateway y no se persiste.
 */
export class AgentClient {
  private socket: GatewaySocketLike | null = null;
  private status: ConnectionStatus = "idle";
  private requestCounter = 0;
  private intentionalClose = false;
  private readonly options: AgentClientOptions;
  private readonly ticketPath: string;
  private readonly factory: WebSocketFactory;

  constructor(options: AgentClientOptions) {
    this.options = options;
    this.ticketPath = options.ticketPath ?? DEFAULT_TICKET_PATH;
    this.factory =
      options.webSocketFactory ??
      ((url: string) => new WebSocket(url) as unknown as GatewaySocketLike);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  /** Handshake completo. Nunca lanza: ante cualquier fallo deja el estado 'unavailable'. */
  async connect(): Promise<void> {
    this.intentionalClose = false;
    this.setStatus("connecting");

    let ticket: ConnectionTicketResponse;
    try {
      // Paso 1: pedir el ticket a FastAPI (cookie del usuario). Reusa el patrón de red.
      ticket = await browserApi<ConnectionTicketResponse>(this.ticketPath, { method: "POST" });
    } catch {
      this.setStatus("unavailable");
      return;
    }

    if (!this.options.gatewayUrl) {
      // Ticket obtenido, pero sin gateway configurado no hay a dónde conectarse.
      this.setStatus("unavailable");
      return;
    }

    try {
      // Paso 2: crear la browser-session en el gateway (setea su cookie de sesión).
      await browserApi(`${this.options.gatewayUrl.replace(/\/+$/u, "")}/v1/browser-sessions`, {
        method: "POST",
        body: { ticket: ticket.ticket },
      });
    } catch {
      this.setStatus("unavailable");
      return;
    }

    // Paso 3: abrir el WebSocket (con la cookie del gateway).
    this.openSocket(this.options.gatewayUrl);
  }

  private openSocket(gatewayUrl: string): void {
    let socket: GatewaySocketLike;
    try {
      socket = this.factory(toWebSocketUrl(gatewayUrl));
    } catch {
      this.setStatus("unavailable");
      return;
    }

    this.socket = socket;
    socket.onopen = () => this.setStatus("connected");
    socket.onmessage = (event) => this.handleMessage(event.data);
    socket.onclose = () => {
      this.socket = null;
      if (!this.intentionalClose) {
        this.setStatus("unavailable");
      }
    };
    socket.onerror = () => this.setStatus("unavailable");
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") {
      return;
    }
    let event: ServerEvent;
    try {
      event = JSON.parse(data) as ServerEvent;
    } catch {
      return;
    }
    this.options.onEvent(event);
  }

  private nextRequestId(prefix: string): string {
    this.requestCounter += 1;
    return `${prefix}_${this.requestCounter}`;
  }

  private send(message: ClientMessage): boolean {
    if (!this.socket || this.status !== "connected") {
      return false;
    }
    this.socket.send(JSON.stringify(message));
    return true;
  }

  startTurn(input: StartTurnInput): string | null {
    const requestId = this.nextRequestId("turn");
    const message: ClientMessage = {
      type: "turn.start",
      request_id: requestId,
      profile_id: input.profileId,
      messages: input.messages,
      generation: input.generation,
    };
    if (input.tools && input.tools.length > 0) {
      message.tools = input.tools;
    }
    return this.send(message) ? requestId : null;
  }

  // B8: el navegador ejecuta la tool y devuelve el resultado, reanudando el turn.
  sendToolResult(turnId: string, callId: string, result: ToolResultPayload): boolean {
    return this.send({ type: "turn.tool_result", turn_id: turnId, call_id: callId, result });
  }

  cancelTurn(turnId?: string): boolean {
    const message: ClientMessage = { type: "agent.cancel_turn", request_id: this.nextRequestId("cancel") };
    if (turnId) {
      message.turn_id = turnId;
    }
    return this.send(message);
  }

  listModels(): boolean {
    return this.send({ type: "models.list", request_id: this.nextRequestId("models") });
  }

  providerStatus(): boolean {
    return this.send({ type: "provider.status", request_id: this.nextRequestId("provider") });
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.setStatus("idle");
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) {
      return;
    }
    this.status = status;
    this.options.onStatusChange(status);
  }
}

export function getAgentGatewayUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_AGENT_GATEWAY_URL;
  if (raw && raw.trim()) {
    return raw.trim();
  }
  // Fallback SAME-ORIGIN: nginx publica el gateway bajo /model-gateway en el mismo origen
  // (prod y dev-vía-nginx). Así las cookies fluyen sin CORS y no hay que hornear la URL.
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/model-gateway`;
  }
  return null;
}
