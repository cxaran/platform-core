"use client";

// Panel del copiloto de platform-core (Fase C). Orquesta el ciclo completo:
//
//   conexión (ticket → browser-session → WS, con reconexión por backoff)
//   → auto-cableado de tools (catálogo /api/v1/resources → deriveResourceTools + ui.*
//     → gating por permisos → toWireToolDefinitions)
//   → turnos (composeLeadingLayers + conversación → turn.start → streaming)
//   → tool-calls (lecturas: ejecutar con la cookie y reanudar; escrituras: plan canónico
//     inmutable → aprobación del usuario → ejecutar EXACTAMENTE lo aprobado).
//
// Autoridades: FastAPI valida RBAC en cada ejecución; el gateway nunca ve los datos; el
// payload de una escritura pendiente vive SOLO en este navegador hasta aprobarse.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { GeneratedUi } from "@/components/copilot/GeneratedUi";
import { AgentClient, getAgentGatewayUrl, type ConnectionStatus } from "@/core/agent/agent-client";
import {
  applyApprovalDecision,
  ApprovalStore,
  buildActionPlan,
  type ActionPlan,
} from "@/core/agent/approval-protocol";
import { loadPreferredModelId, savePreferredModelId } from "@/core/agent/model-preference";
import { composeLeadingLayers } from "@/core/agent/persona";
import type { ServerEvent, WireMessage, WireModel } from "@/core/agent/protocol";
import {
  initialReconnectState,
  reduceReconnect,
  type ReconnectState,
} from "@/core/agent/reconnect-machine";
import { creatableResources, effectiveTools } from "@/core/agent/tool-catalog";
import { deriveResourceTools } from "@/core/agent/tools/contract-tools";
import {
  defaultToolContext,
  toWireToolDefinitions,
  type ToolDefinition,
} from "@/core/agent/tools/registry";
import { executeTool, resolveToolCall } from "@/core/agent/tools/tool-runner";
import { BASE_UI_TOOLS } from "@/core/agent/tools/ui-tools";
import { isUiSpec, type UiSpec } from "@/core/agent/tools/ui-spec";
import {
  failInFlightTurn,
  initialTurnState,
  reduceTurnEvent,
  type TurnState,
} from "@/core/agent/turn-reducer";
import { turnFailureMessage } from "@/core/agent/turn-error";
import { browserApi } from "@/core/api/browser-client";
import { fetchResourceCatalog } from "@/core/resources/embedded-list-client";
import type { SessionUser } from "@/core/auth/types";

const MAX_OUTPUT_TOKENS = 1024;

type ToolCallStatus = "running" | "success" | "error" | "awaiting_approval" | "rejected";

interface ToolCallView {
  callId: string;
  toolName: string;
  kind: "read" | "write";
  status: ToolCallStatus;
  /** Plan canónico (solo escrituras): lo que el usuario aprueba. */
  plan?: ActionPlan;
  /** Id de la solicitud de aprobación pendiente (solo escrituras). */
  approvalId?: string;
  /** Vista previa breve del resultado o mensaje de error. */
  detail?: string;
  /** Spec de UI generada (tools ui.*) para render con GeneratedUi. */
  uiSpec?: UiSpec;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  reasoning?: string;
  toolCalls?: ToolCallView[];
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  idle: "Inactivo",
  connecting: "Conectando…",
  connected: "Conectado",
  unavailable: "No disponible",
};

function briefContent(content: unknown): string {
  let text: string;
  try {
    text = typeof content === "string" ? content : JSON.stringify(content) ?? String(content);
  } catch {
    text = String(content);
  }
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
}

export interface CopilotPanelProps {
  /** Título del panel (el producto puede personalizarlo). */
  title?: string;
}

export function CopilotPanel({ title = "Copiloto" }: CopilotPanelProps) {
  const clientRef = useRef<AgentClient | null>(null);
  const reconnectRef = useRef<ReconnectState>(initialReconnectState());
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const approvalStoreRef = useRef(new ApprovalStore());
  // requestId → contexto necesario para ejecutar la escritura tras aprobarse.
  const pendingWritesRef = useRef(
    new Map<string, { tool: ToolDefinition; turnId: string; callId: string }>(),
  );
  const idCounterRef = useRef(0);
  const toolsRef = useRef<ToolDefinition[]>([]);
  const turnRef = useRef<TurnState>(initialTurnState());
  const currentCallsRef = useRef<ToolCallView[]>([]);

  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [turn, setTurn] = useState<TurnState>(initialTurnState());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentCalls, setCurrentCalls] = useState<ToolCallView[]>([]);
  const [models, setModels] = useState<WireModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [toolCount, setToolCount] = useState(0);
  const [input, setInput] = useState("");

  const nextId = useCallback((prefix: string): string => {
    idCounterRef.current += 1;
    return `${prefix}_${idCounterRef.current}`;
  }, []);

  const setTurnState = useCallback((next: TurnState) => {
    turnRef.current = next;
    setTurn(next);
  }, []);

  const setCalls = useCallback((updater: (prev: ToolCallView[]) => ToolCallView[]) => {
    currentCallsRef.current = updater(currentCallsRef.current);
    setCurrentCalls(currentCallsRef.current);
  }, []);

  // --- Tool-calls -----------------------------------------------------------------

  const handleToolCall = useCallback(
    async (event: Extract<ServerEvent, { type: "turn.tool_call.ready" }>) => {
      const client = clientRef.current;
      if (!client) return;

      const resolved = resolveToolCall(event.tool_name, event.arguments, toolsRef.current);
      if (resolved.outcome !== "ready") {
        setCalls((prev) => [
          ...prev,
          {
            callId: event.call_id,
            toolName: event.tool_name,
            kind: "read",
            status: "error",
            detail: resolved.result.status === "error" ? resolved.result.message : undefined,
          },
        ]);
        client.sendToolResult(event.turn_id, event.call_id, resolved.result);
        return;
      }

      const { tool, args } = resolved;

      if (tool.kind === "write") {
        // ESCRITURA: nunca se ejecuta directo. Plan canónico → solicitud de aprobación.
        const plan = buildActionPlan(tool, args);
        const approvalId = nextId("approval");
        approvalStoreRef.current.request({
          id: approvalId,
          turnId: event.turn_id,
          callId: event.call_id,
          toolName: tool.name,
          plan,
        });
        pendingWritesRef.current.set(approvalId, {
          tool,
          turnId: event.turn_id,
          callId: event.call_id,
        });
        setCalls((prev) => [
          ...prev,
          {
            callId: event.call_id,
            toolName: tool.name,
            kind: "write",
            status: "awaiting_approval",
            plan,
            approvalId,
          },
        ]);
        return;
      }

      // LECTURA: ejecutar con la cookie del usuario (FastAPI revalida RBAC) y reanudar.
      setCalls((prev) => [
        ...prev,
        { callId: event.call_id, toolName: tool.name, kind: "read", status: "running" },
      ]);
      const result = await executeTool(tool, args, defaultToolContext);
      const uiSpec =
        result.status === "success" && isUiSpec(result.content) ? result.content : undefined;
      setCalls((prev) =>
        prev.map((call) =>
          call.callId === event.call_id
            ? {
                ...call,
                status: result.status === "success" ? "success" : "error",
                detail:
                  result.status === "success"
                    ? uiSpec
                      ? `Interfaz "${uiSpec.kind}" mostrada.`
                      : briefContent(result.content)
                    : result.message,
                uiSpec,
              }
            : call,
        ),
      );
      client.sendToolResult(event.turn_id, event.call_id, result);
    },
    [nextId, setCalls],
  );

  const approveWrite = useCallback(
    async (approvalId: string) => {
      const client = clientRef.current;
      const pending = pendingWritesRef.current.get(approvalId);
      if (!client || !pending) return;

      const outcome = applyApprovalDecision(approvalStoreRef.current, approvalId, "approved");
      if (outcome.kind !== "execute") return;
      pendingWritesRef.current.delete(approvalId);

      setCalls((prev) =>
        prev.map((call) =>
          call.approvalId === approvalId ? { ...call, status: "running" } : call,
        ),
      );
      // Se ejecuta EXACTAMENTE el payload aprobado (inmutable), no los args originales.
      const result = await executeTool(
        pending.tool,
        { ...outcome.request.plan.exactPayload },
        defaultToolContext,
      );
      setCalls((prev) =>
        prev.map((call) =>
          call.approvalId === approvalId
            ? {
                ...call,
                status: result.status === "success" ? "success" : "error",
                detail:
                  result.status === "success" ? briefContent(result.content) : result.message,
              }
            : call,
        ),
      );
      client.sendToolResult(pending.turnId, pending.callId, result);
    },
    [setCalls],
  );

  const rejectWrite = useCallback(
    (approvalId: string) => {
      const client = clientRef.current;
      const pending = pendingWritesRef.current.get(approvalId);
      if (!client || !pending) return;

      const outcome = applyApprovalDecision(approvalStoreRef.current, approvalId, "rejected");
      if (outcome.kind !== "discard") return;
      pendingWritesRef.current.delete(approvalId);

      setCalls((prev) =>
        prev.map((call) =>
          call.approvalId === approvalId ? { ...call, status: "rejected" } : call,
        ),
      );
      client.sendToolResult(pending.turnId, pending.callId, outcome.result);
    },
    [setCalls],
  );

  // --- Eventos del gateway ----------------------------------------------------------

  const applyEvent = useCallback(
    (event: ServerEvent) => {
      if (event.type === "models.list.result") {
        setModels(event.models);
        setSelectedModel((current) => {
          if (current && event.models.some((model) => model.id === current)) {
            return current;
          }
          const preferred = loadPreferredModelId();
          if (preferred && event.models.some((model) => model.id === preferred)) {
            return preferred;
          }
          return event.models[0]?.id ?? "";
        });
        return;
      }
      if (event.type === "turn.tool_call.ready") {
        setTurnState(reduceTurnEvent(turnRef.current, event));
        void handleToolCall(event);
        return;
      }

      const next = reduceTurnEvent(turnRef.current, event);
      setTurnState(next);

      // Cierre del turno: anclar el mensaje del asistente con sus tool-calls.
      if (
        event.type === "turn.completed" ||
        event.type === "turn.cancelled" ||
        event.type === "turn.failed"
      ) {
        const calls = currentCallsRef.current;
        const text =
          event.type === "turn.failed"
            ? turnFailureMessage(next.error, null)
            : next.assistantText || (event.type === "turn.cancelled" ? "(turno cancelado)" : "");
        setMessages((prev) => [
          ...prev,
          {
            id: `msg_a_${prev.length}`,
            role: "assistant",
            text,
            ...(next.reasoningText ? { reasoning: next.reasoningText } : {}),
            ...(calls.length > 0 ? { toolCalls: calls } : {}),
          },
        ]);
        currentCallsRef.current = [];
        setCurrentCalls([]);
        setTurnState({ ...initialTurnState(), status: "idle" });
      }
    },
    [handleToolCall, setTurnState],
  );

  // --- Conexión + reconexión ---------------------------------------------------------

  useEffect(() => {
    const gatewayUrl = getAgentGatewayUrl();
    const client = new AgentClient({
      gatewayUrl,
      onEvent: applyEvent,
      onStatusChange: (next) => {
        setStatus(next);
        if (next === "connected") {
          reconnectRef.current = reduceReconnect(reconnectRef.current, { type: "connected" });
          client.listModels();
          return;
        }
        if (next === "unavailable") {
          // Canal caído: fallar limpio el turno en vuelo y programar el reintento (backoff).
          setTurnState(failInFlightTurn(turnRef.current, "Se perdió la conexión con el copiloto."));
          const dropped = reduceReconnect(reconnectRef.current, { type: "dropped" });
          reconnectRef.current = dropped;
          if (dropped.phase === "reconnecting" && dropped.nextDelayMs !== null) {
            retryTimerRef.current = setTimeout(() => {
              reconnectRef.current = reduceReconnect(reconnectRef.current, { type: "retry" });
              void client.connect();
            }, dropped.nextDelayMs);
          }
        }
      },
    });
    clientRef.current = client;
    reconnectRef.current = reduceReconnect(reconnectRef.current, { type: "connect_start" });
    void client.connect();

    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
      reconnectRef.current = reduceReconnect(reconnectRef.current, { type: "dispose" });
      client.disconnect();
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Auto-cableado de tools desde el contrato ---------------------------------------

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [catalog, session] = await Promise.all([
          fetchResourceCatalog(),
          browserApi<SessionUser>("/api/v1/auth/me", { method: "GET" }),
        ]);
        if (cancelled) return;
        const derived = deriveResourceTools(catalog, BASE_UI_TOOLS);
        const all = [...BASE_UI_TOOLS, ...derived];
        const granted = new Set(session.permissions ?? []);
        toolsRef.current = effectiveTools(all, creatableResources(catalog), granted);
        setToolCount(toolsRef.current.length);
      } catch {
        // Sin catálogo (sesión caída, error transitorio): el copiloto queda sin tools de
        // recursos este montaje; las ui.* básicas siguen disponibles.
        if (!cancelled) {
          toolsRef.current = [...BASE_UI_TOOLS];
          setToolCount(toolsRef.current.length);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Envío de turnos -----------------------------------------------------------------

  const busy = turn.status === "running" || turn.status === "waiting_for_tool";

  const sendMessage = useCallback(
    (text: string) => {
      const client = clientRef.current;
      const trimmed = text.trim();
      if (!client || !trimmed || !selectedModel || busy) return;

      const history: WireMessage[] = messages.map((message) => ({
        role: message.role,
        content: [{ type: "text", text: message.text }],
      }));
      const wire: WireMessage[] = [
        ...composeLeadingLayers(null, null),
        ...history,
        { role: "user", content: [{ type: "text", text: trimmed }] },
      ];

      const requestId = client.startTurn({
        profileId: selectedModel,
        messages: wire,
        tools: toWireToolDefinitions(toolsRef.current),
        generation: { max_output_tokens: MAX_OUTPUT_TOKENS },
      });
      if (requestId === null) return;

      setMessages((prev) => [
        ...prev,
        { id: `msg_u_${prev.length}`, role: "user", text: trimmed },
      ]);
      setInput("");
      setTurnState({ ...initialTurnState(), status: "running" });
    },
    [busy, messages, selectedModel, setTurnState],
  );

  const followUp = useCallback(
    (text: string) => {
      sendMessage(text);
    },
    [sendMessage],
  );

  const modelOptions = useMemo(
    () =>
      models.map((model) => (
        <option key={model.id} value={model.id}>
          {model.label}
        </option>
      )),
    [models],
  );

  // --- Render ---------------------------------------------------------------------------

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-[var(--tx)]">{title}</h2>
          <span className="rounded-full border border-[var(--border2)] px-2 py-0.5 text-[10px] text-[var(--tx3)]">
            {STATUS_LABEL[status]}
          </span>
          {toolCount > 0 ? (
            <span className="text-[10px] text-[var(--tx3)]">{toolCount} herramientas</span>
          ) : null}
        </div>
        <p className="text-[10px] text-[var(--tx3)]">
          Toda escritura requiere tu aprobación antes de guardarse.
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-[14px] border border-[var(--border2)] bg-[var(--bg2)] p-4">
        {messages.length === 0 && !busy ? (
          <p className="text-sm text-[var(--tx3)]">
            Pregunta por tus datos o pide crear/editar registros: las herramientas se derivan
            automáticamente de los recursos que tu rol puede ver.
          </p>
        ) : null}

        {messages.map((message) => (
          <MessageView key={message.id} message={message} onFollowUp={followUp} busy={busy} />
        ))}

        {busy || turn.assistantText || currentCalls.length > 0 ? (
          <div className="flex flex-col gap-2">
            {turn.reasoningText ? (
              <details className="text-xs text-[var(--tx3)]">
                <summary>Razonamiento</summary>
                <p className="whitespace-pre-wrap">{turn.reasoningText}</p>
              </details>
            ) : null}
            {currentCalls.map((call) => (
              <ToolCallCard
                key={call.callId}
                call={call}
                onApprove={approveWrite}
                onReject={rejectWrite}
                onFollowUp={followUp}
                busy={busy}
              />
            ))}
            {turn.assistantText ? (
              <p className="whitespace-pre-wrap text-sm text-[var(--tx)]">{turn.assistantText}</p>
            ) : busy ? (
              <p className="text-sm text-[var(--tx3)]">Pensando…</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <footer className="flex items-center gap-2">
        <Select
          className="!w-56"
          value={selectedModel}
          disabled={models.length === 0}
          onChange={(event) => {
            setSelectedModel(event.target.value);
            savePreferredModelId(event.target.value);
          }}
        >
          {models.length === 0 ? <option value="">Sin modelos</option> : modelOptions}
        </Select>
        <input
          className="min-w-0 flex-1 rounded-[11px] border border-[var(--border2)] bg-[var(--bg2)] px-3 py-2.5 text-sm text-[var(--tx)] outline-none focus:border-[var(--accent-bd)]"
          placeholder={
            status === "connected" ? "Escribe un mensaje…" : "Esperando conexión con el copiloto…"
          }
          value={input}
          disabled={status !== "connected"}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              sendMessage(input);
            }
          }}
        />
        {busy ? (
          <Button type="button" onClick={() => clientRef.current?.cancelTurn(turn.turnId ?? undefined)}>
            Detener
          </Button>
        ) : (
          <Button
            type="button"
            disabled={status !== "connected" || !selectedModel || !input.trim()}
            onClick={() => sendMessage(input)}
          >
            Enviar
          </Button>
        )}
      </footer>
    </div>
  );
}

function MessageView({
  message,
  onFollowUp,
  busy,
}: {
  message: ChatMessage;
  onFollowUp: (text: string) => void;
  busy: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="self-end rounded-[14px] bg-[var(--accent)] px-4 py-2.5 text-sm text-[var(--on-accent)]">
        <p className="whitespace-pre-wrap">{message.text}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {message.reasoning ? (
        <details className="text-xs text-[var(--tx3)]">
          <summary>Razonamiento</summary>
          <p className="whitespace-pre-wrap">{message.reasoning}</p>
        </details>
      ) : null}
      {(message.toolCalls ?? []).map((call) => (
        <ToolCallCard key={call.callId} call={call} onFollowUp={onFollowUp} busy={busy} />
      ))}
      {message.text ? (
        <p className="whitespace-pre-wrap text-sm text-[var(--tx)]">{message.text}</p>
      ) : null}
    </div>
  );
}

const TOOL_STATUS_LABEL: Record<ToolCallStatus, string> = {
  running: "Ejecutando…",
  success: "Completada",
  error: "Error",
  awaiting_approval: "Requiere aprobación",
  rejected: "Rechazada",
};

function ToolCallCard({
  call,
  onApprove,
  onReject,
  onFollowUp,
  busy,
}: {
  call: ToolCallView;
  onApprove?: (approvalId: string) => void;
  onReject?: (approvalId: string) => void;
  onFollowUp: (text: string) => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[12px] border border-[var(--border2)] bg-[var(--bg)] p-3">
      <div className="flex items-center gap-2 text-xs">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            call.kind === "write"
              ? "bg-amber-500/15 text-amber-600"
              : "bg-[var(--accent)]/10 text-[var(--accent)]"
          }`}
        >
          {call.kind === "write" ? "Escritura" : "Lectura"}
        </span>
        <code className="text-[var(--tx2)]">{call.toolName}</code>
        <span className="ml-auto text-[10px] text-[var(--tx3)]">
          {TOOL_STATUS_LABEL[call.status]}
        </span>
      </div>

      {call.status === "awaiting_approval" && call.plan ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-[var(--tx)]">{call.plan.humanReadableSummary}</p>
          <details className="text-xs text-[var(--tx3)]">
            <summary>Datos exactos que se enviarán</summary>
            <pre className="overflow-x-auto rounded bg-[var(--bg2)] p-2 text-[11px]">
              {JSON.stringify(call.plan.exactPayload, null, 2)}
            </pre>
          </details>
          <p className="text-[10px] text-[var(--tx3)]">
            Nada se guarda hasta que apruebes exactamente lo anterior.
          </p>
          {call.approvalId && onApprove && onReject ? (
            <div className="flex gap-2">
              <Button type="button" className="!px-3 !py-1.5 !text-xs" onClick={() => onApprove(call.approvalId!)}>
                Aprobar
              </Button>
              <button
                type="button"
                className="rounded-[11px] border border-[var(--border2)] px-3 py-1.5 text-xs text-[var(--tx2)] transition hover:border-red-400 hover:text-red-500"
                onClick={() => onReject(call.approvalId!)}
              >
                Rechazar
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {call.uiSpec ? (
        <GeneratedUi spec={call.uiSpec} onFollowUp={onFollowUp} disabled={busy} />
      ) : call.detail && call.status !== "awaiting_approval" ? (
        <p className="break-all text-xs text-[var(--tx3)]">{call.detail}</p>
      ) : null}
    </div>
  );
}
