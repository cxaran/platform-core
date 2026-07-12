import { ApiRequestError } from "@/core/api/api-error";

import {
  getTool,
  defaultToolContext,
  ToolExecutionError,
  type ToolDefinition,
  type ToolExecutionContext,
} from "./registry";
import { normalizeToolArgs, validateArgs } from "./schema-validator";

// Resultado que se devuelve al gateway en turn.tool_result (forma de cable de B6).
export type ToolResultPayload =
  | { status: "success"; content: unknown }
  | { status: "error"; code: string; message: string };

export type ResolvedToolCall =
  | { outcome: "unknown_tool"; result: ToolResultPayload }
  | { outcome: "invalid_args"; result: ToolResultPayload }
  | { outcome: "ready"; tool: ToolDefinition; args: Record<string, unknown> };

function asArgsObject(args: unknown): Record<string, unknown> {
  return typeof args === "object" && args !== null && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
}

/**
 * Busca la tool por nombre y valida los argumentos contra su input schema. No ejecuta
 * nada: separa el lookup/validación (puro) de la ejecución (efecto de red). Una tool
 * desconocida o con args inválidos produce un tool_result de error para el modelo.
 *
 * ``extraTools`` permite despachar tools que NO están en el registro nativo (``getTool``),
 * como las de MCP: el panel pasa SÓLO las EFECTIVAS tras el gating, de modo que una tool MCP
 * gateada por rol nunca se resuelve (no se puede ejecutar). El registro nativo tiene prioridad,
 * así que no hay regresión para las tools nativas.
 */
export function resolveToolCall(
  name: string,
  args: unknown,
  extraTools: readonly ToolDefinition[] = [],
): ResolvedToolCall {
  const tool = getTool(name) ?? extraTools.find((candidate) => candidate.name === name);
  if (!tool) {
    return {
      outcome: "unknown_tool",
      result: { status: "error", code: "unknown_tool", message: `Herramienta desconocida: ${name}` },
    };
  }

  // Sanea placeholders alucinados (UUID nil / cadena vacía en campos UUID opcionales) ANTES de
  // validar y ejecutar: un id opcional inventado por el modelo se trata como ausente, no se manda.
  const argsObject = asArgsObject(normalizeToolArgs(tool.inputSchema, asArgsObject(args)));
  const validation = validateArgs(tool.inputSchema, argsObject);
  if (!validation.valid) {
    return {
      outcome: "invalid_args",
      result: {
        status: "error",
        code: "invalid_arguments",
        message: `Argumentos inválidos para ${name}: ${validation.errors.join(" ")}`,
      },
    };
  }

  return { outcome: "ready", tool, args: argsObject };
}

function mapApiError(error: ApiRequestError): ToolResultPayload {
  if (error.status === 403) {
    return { status: "error", code: "forbidden", message: "El usuario no tiene permiso para esta acción." };
  }
  if (error.status === 404) {
    return { status: "error", code: "not_found", message: "El recurso solicitado no existe o no es visible." };
  }
  if (error.status === 401) {
    return { status: "error", code: "unauthenticated", message: "La sesión no es válida." };
  }
  // Mensaje del backend (no incluye datos del negocio crudos); seguro para el modelo/usuario.
  return { status: "error", code: error.body.code || `http_${error.status}`, message: error.body.message };
}

/**
 * Ejecuta una tool ya resuelta usando la cookie del usuario (FastAPI valida permisos).
 * Nunca lanza: traduce cualquier fallo a un tool_result de error estructurado. No
 * registra datos del negocio en logs.
 */
export async function executeTool(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext = defaultToolContext,
): Promise<ToolResultPayload> {
  try {
    const content = await tool.execute(args, ctx);
    return { status: "success", content };
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return mapApiError(error);
    }
    if (error instanceof ToolExecutionError) {
      return { status: "error", code: error.code, message: error.message };
    }
    return { status: "error", code: "execution_failed", message: "No se pudo ejecutar la herramienta." };
  }
}

export function rejectedByUserResult(): { status: "error"; code: string; message: string } {
  return {
    status: "error",
    code: "rejected_by_user",
    message: "El usuario rechazó la ejecución de la herramienta.",
  };
}
