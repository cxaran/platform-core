import { browserApi } from "@/core/api/browser-client";
import type { ApiRequestInit } from "@/core/api/request";
import type { WireTool } from "@/core/agent/protocol";

import type { ObjectSchema } from "./schema-validator";
import { browserSandboxRunner, type SandboxRunner } from "./sandbox";

export type ToolKind = "read" | "write";

// Error de ejecución de una tool NO basada en la API REST (sandbox, specs de UI). Lo
// traduce executeTool a un tool_result de error estructurado.
export class ToolExecutionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ToolExecutionError";
    this.code = code;
  }
}

// API inyectable (por defecto el cliente de navegador con cookie del usuario). En tests
// se inyecta un fetch mockeado a través de browserApi -> globalThis.fetch.
export type ToolApi = <T>(path: string, init?: ApiRequestInit) => Promise<T>;

export interface ToolExecutionContext {
  api: ToolApi;
  // Runner del sandbox de JS (inyectable en tests; por defecto el Web Worker real).
  sandbox: SandboxRunner;
}

// Metadata de aprobación de una tool de ESCRITURA: alimenta el plan canónico que el
// usuario aprueba (P1). Genérica: cualquier tool de escritura puede declararla para dar un
// resumen en español; sin ella, el protocolo cae a un resumen genérico.
export interface ToolApprovalMeta {
  // Tipo de acción para el plan (p. ej. ``create_users``).
  actionType: string;
  // Recurso destino afectado (p. ej. ``users``).
  targetResource: string;
  // Resumen legible en español de lo que ocurriría si se aprueba.
  summarize: (args: Record<string, unknown>) => string;
  // Escritura OWNER-SCOPED (sobre datos del propio usuario, p. ej. sus preferencias): no se
  // gatea por el catálogo de recursos RBAC (no es un recurso global), pero SÍ pasa por la
  // aprobación del usuario como cualquier otra escritura. Sin esto, una escritura se gatea por rol.
  ownerScoped?: boolean;
  // Escritura YA AUTORIZADA por la proyección del contrato (tools derivadas de /resources): el
  // backend sólo expone el form/acción si concede el permiso, así que el gate de "creable" no
  // aplica (cubre update/acciones sobre recursos editables pero no creables). Igual pasa por P1.
  preauthorized?: boolean;
  // Gate ALTERNATIVO por permiso explícito (de la sesión /auth/me) para recursos que a propósito
  // NO publican formulario genérico en el catálogo. La tool se declara si el usuario tiene TODOS
  // estos permisos. Defensa en profundidad: FastAPI revalida cada ejecución; esto solo evita
  // ofrecer al modelo lo que el usuario no puede hacer.
  requiredPermissions?: readonly string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  kind: ToolKind;
  // Procedencia legible EXPLÍCITA (p. ej. "MCP: <servidor>"). Si se omite, la procedencia se
  // infiere del prefijo del nombre (ver tool-catalog ``toolSource``). Lo usan las tools cuya
  // familia no se deduce del nombre, como las descubiertas por MCP.
  source?: string;
  // Esquema usado para validar args localmente (validador propio acotado).
  inputSchema: ObjectSchema;
  // Esquema rico (JSON Schema) que se declara al modelo cuando inputSchema es permisivo
  // (p.ej. specs de UI con estructuras anidadas que el validador local no cubre).
  wireSchema?: Record<string, unknown>;
  // Solo tools de escritura: metadata para el protocolo de aprobación.
  approval?: ToolApprovalMeta;
  execute: (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<unknown>;
}

export const defaultToolContext: ToolExecutionContext = {
  api: <T>(path: string, init?: ApiRequestInit) => browserApi<T>(path, init),
  sandbox: browserSandboxRunner,
};

// Registro BASE de tools de platform-core. Es la plataforma genérica: NO trae tools de dominio
// hand-written. Las tools EFECTIVAS se componen en el panel a partir de tres fuentes que se pasan
// como ``extraTools`` a ``resolveToolCall``: las transversales ``ui.*`` (``BASE_UI_TOOLS`` en
// ``ui-tools.ts``) y las DERIVADAS del contrato (``deriveResourceTools`` sobre ``/api/v1/resources``).
// Este array queda vacío a propósito (evita un ciclo de imports registry↔ui-tools).
const TOOLS: ToolDefinition[] = [];

export function getTool(name: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

export function listTools(): ToolDefinition[] {
  return [...TOOLS];
}

export function toWireToolDefinitions(tools: ToolDefinition[] = TOOLS): WireTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: (tool.wireSchema ?? tool.inputSchema) as unknown as Record<string, unknown>,
    strict: false,
  }));
}
