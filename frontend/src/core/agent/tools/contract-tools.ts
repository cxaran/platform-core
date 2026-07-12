// Tools del agente DERIVADAS DEL CONTRATO (`/api/v1/resources`). En vez de mantener a mano un
// `resource.*` por cada endpoint, este módulo SINTETIZA ToolDefinitions genéricas (crear/editar/
// listar/ver + acciones) a partir del catálogo de capacidades que ya manda el backend. Así, cuando el
// backend agrega un recurso, un campo o una acción, el agente lo ve en su siguiente carga SIN tocar
// el front.
//
// Principios:
//  - El contrato YA viene proyectado por permiso (sólo aparece lo creable/editable/visible para el
//    rol), así que las tools derivadas nacen acotadas por RBAC. El backend revalida igual.
//  - PRECEDENCIA de las hand-written: si ya existe una tool curada para (recurso, operación) —con su
//    guía rica y flujos especiales (flujos especiales…)— la derivada se OMITE.
//  - Las escrituras llevan metadata de aprobación (P1): nada se guarda sin el usuario.
//  - `inputSchema` es el subconjunto que valida el validador local; `wireSchema` es el JSON Schema
//    rico que ve el modelo (incluye arrays y formatos). El backend es la fuente de verdad.

import type {
  ResourceActionCapability,
  ResourceCapability,
  ResourceCatalog,
  ResourceFormCapability,
  ResourceFormFieldCapability,
} from "@/core/api/contracts";
import { fillPlaceholder } from "@/core/resources/item-reference";
import type { ObjectSchema, PropSchema } from "./schema-validator";
import type { ToolDefinition } from "./registry";

type WireSchema = {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: boolean;
};

function fieldDescription(field: ResourceFormFieldCapability): string {
  return field.description ?? field.label;
}

/** Mapea un campo del contrato a PropSchema del validador local (null si el tipo no es soportable). */
function localProp(field: ResourceFormFieldCapability): PropSchema | null {
  const description = fieldDescription(field);
  switch (field.type) {
    case "integer":
      return { type: "integer", description };
    case "decimal":
      return { type: "number", description };
    case "boolean":
      return { type: "boolean", description };
    case "uuid":
      return { type: "string", format: "uuid", description };
    case "enum": {
      const values = (field.options ?? []).map((option) => option.value);
      return values.length > 0
        ? { type: "string", enum: values, description }
        : { type: "string", description };
    }
    case "string":
    case "email":
    case "date":
    case "time":
    case "datetime":
      return { type: "string", description };
    case "array":
      // El validador local no expresa arrays; se valida en el backend (va sólo en wireSchema).
      return null;
    default:
      return { type: "string", description };
  }
}

/** Mapea un campo del contrato a una propiedad JSON Schema rica (la que ve el modelo). */
function wireProp(field: ResourceFormFieldCapability): Record<string, unknown> {
  const description = fieldDescription(field);
  switch (field.type) {
    case "integer":
      return { type: "integer", description };
    case "decimal":
      return { type: "number", description };
    case "boolean":
      return { type: "boolean", description };
    case "uuid":
      return { type: "string", format: "uuid", description };
    case "date":
      return { type: "string", format: "date", description };
    case "datetime":
      return { type: "string", format: "date-time", description };
    case "email":
      return { type: "string", format: "email", description };
    case "enum": {
      const values = (field.options ?? []).map((option) => option.value);
      return values.length > 0
        ? { type: "string", enum: values, description }
        : { type: "string", description };
    }
    case "array":
      return { type: "array", items: { type: "string" }, description };
    default:
      return { type: "string", description };
  }
}

interface ExtraProp {
  key: string;
  local: PropSchema;
  wire: Record<string, unknown>;
  required: boolean;
}

/** Arma {inputSchema, wireSchema} desde los campos del contrato + props extra (p. ej. el id). */
function buildSchemas(
  fields: readonly ResourceFormFieldCapability[],
  extras: readonly ExtraProp[] = [],
): { inputSchema: ObjectSchema; wireSchema: WireSchema } {
  const localProps: Record<string, PropSchema> = {};
  const wireProps: Record<string, Record<string, unknown>> = {};
  const localRequired: string[] = [];
  const wireRequired: string[] = [];
  let hasUnsupported = false;

  for (const extra of extras) {
    localProps[extra.key] = extra.local;
    wireProps[extra.key] = extra.wire;
    if (extra.required) {
      localRequired.push(extra.key);
      wireRequired.push(extra.key);
    }
  }

  for (const field of fields) {
    // Sólo campos editables: los de solo lectura (auditoría, etc.) no se ofrecen para escribir.
    if (field.editable === false) continue;
    wireProps[field.name] = wireProp(field);
    if (field.required) wireRequired.push(field.name);
    const local = localProp(field);
    if (!local) {
      hasUnsupported = true; // p. ej. array: pasa por additionalProperties y lo valida el backend.
      continue;
    }
    localProps[field.name] = local;
    if (field.required) localRequired.push(field.name);
  }

  return {
    inputSchema: {
      type: "object",
      properties: localProps,
      required: localRequired,
      // Si hay campos no expresables localmente (array), se permiten extras y el backend valida.
      additionalProperties: hasUnsupported,
    },
    wireSchema: {
      type: "object",
      properties: wireProps,
      required: wireRequired,
      additionalProperties: false,
    },
  };
}

/** Allowlist: del objeto de args sólo se conservan los campos declarados por el contrato. */
function buildPayload(
  fields: readonly ResourceFormFieldCapability[],
  args: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.editable === false) continue;
    const value = args[field.name];
    if (value !== undefined && value !== null && value !== "") {
      payload[field.name] = value;
    }
  }
  return payload;
}

/** Cola de resumen (P1): primer par etiqueta:valor presente, para el plan que aprueba el usuario. */
function summaryTail(
  fields: readonly ResourceFormFieldCapability[],
  args: Record<string, unknown>,
): string {
  for (const field of fields) {
    const value = args[field.name];
    if (typeof value === "string" && value.trim()) {
      return ` — ${field.label}: ${value.trim()}`;
    }
  }
  return "";
}

const ID_LOCAL: PropSchema = { type: "string", description: "Id del registro." };
const ID_WIRE: Record<string, unknown> = { type: "string", description: "Id del registro." };

function idExtra(label: string): ExtraProp {
  return {
    key: "id",
    local: { ...ID_LOCAL, description: `Id del ${label} objetivo.` },
    wire: { ...ID_WIRE, description: `Id del ${label} objetivo.` },
    required: true,
  };
}

function createTool(cap: ResourceCapability, form: ResourceFormCapability): ToolDefinition | null {
  // El alta multipart (archivo) no se deriva: el agente no sube binarios por args de tool.
  if (form.transport === "multipart") return null;
  const { inputSchema, wireSchema } = buildSchemas(form.fields);
  return {
    name: `resource.create_${cap.name}`,
    description: `Crea ${cap.label} con los campos del contrato del backend.`,
    kind: "write",
    inputSchema,
    wireSchema,
    approval: {
      actionType: `create_${cap.name}`,
      targetResource: cap.name,
      preauthorized: true,
      summarize: (args) => `Crear ${cap.label}${summaryTail(form.fields, args)}.`,
    },
    execute: (args, ctx) =>
      ctx.api(form.url_template, { method: form.method, body: buildPayload(form.fields, args) }),
  };
}

function updateTool(cap: ResourceCapability, form: ResourceFormCapability): ToolDefinition | null {
  const reference = cap.item_reference;
  if (!reference) return null;
  const { inputSchema, wireSchema } = buildSchemas(form.fields, [idExtra(cap.label)]);
  return {
    name: `resource.update_${cap.name}`,
    description: `Edita ${cap.label} existente con los campos del contrato del backend.`,
    kind: "write",
    inputSchema,
    wireSchema,
    approval: {
      actionType: `update_${cap.name}`,
      targetResource: cap.name,
      preauthorized: true,
      summarize: (args) =>
        `Editar ${cap.label} (id ${String(args.id ?? "—")})${summaryTail(form.fields, args)}.`,
    },
    execute: (args, ctx) => {
      const url = fillPlaceholder(form.url_template, reference.placeholder, String(args.id ?? ""));
      return ctx.api(url, { method: form.method, body: buildPayload(form.fields, args) });
    },
  };
}

function getTool(cap: ResourceCapability): ToolDefinition | null {
  const reference = cap.item_reference;
  const detail = cap.detail;
  if (!reference || !detail) return null;
  const idProp = idExtra(cap.label);
  return {
    name: `resource.get_${cap.name}`,
    description: `Obtiene un ${cap.label} por id (lectura).`,
    kind: "read",
    inputSchema: {
      type: "object",
      properties: { id: idProp.local },
      required: ["id"],
      additionalProperties: false,
    },
    wireSchema: {
      type: "object",
      properties: { id: idProp.wire },
      required: ["id"],
      additionalProperties: false,
    },
    execute: (args, ctx) => {
      const url = fillPlaceholder(detail.url_template, reference.placeholder, String(args.id ?? ""));
      return ctx.api(url);
    },
  };
}

// Un parámetro de query derivado del contrato declarativo de filtros.
type FilterParam = { name: string; description: string; valueType: string; options?: string[] };

// Deriva TODOS los parámetros de filtro de ``filterable_fields`` (la fuente única del
// plan compilado): por campo, cada operador publica su parameter_name (un valor) o su
// par from/to (rango). Antes las tools leían el contrato legacy ``filters`` (solo los
// declarados a mano con ui.filter), así que el copiloto no veía los rangos gte/lte
// automáticos ni los operadores de calendario que la UI sí ofrece.
function filterParams(list: NonNullable<ResourceCapability["list"]>): FilterParam[] {
  const params: FilterParam[] = [];
  for (const field of list.filterable_fields) {
    const base = field.description ?? field.label;
    for (const operator of field.operators) {
      const options =
        operator.options && operator.options.length > 0
          ? operator.options.map((option) => option.value)
          : undefined;
      const describe = (suffix: string) =>
        operator.key === "eq" ? base : `${base} — ${operator.label}${suffix}`;
      if (operator.parameter_name) {
        params.push({
          name: operator.parameter_name,
          description: describe(""),
          valueType: field.value_type,
          options,
        });
      } else if (operator.parameters) {
        params.push({
          name: operator.parameters.from,
          description: describe(" (desde)"),
          valueType: field.value_type,
          options,
        });
        params.push({
          name: operator.parameters.to,
          description: describe(" (hasta)"),
          valueType: field.value_type,
          options,
        });
      }
    }
  }
  return params;
}

function filterProp(param: FilterParam): PropSchema {
  if (param.options) {
    return { type: "string", enum: param.options, description: param.description };
  }
  if (param.valueType === "integer") return { type: "integer", description: param.description };
  if (param.valueType === "decimal") return { type: "number", description: param.description };
  if (param.valueType === "boolean") return { type: "boolean", description: param.description };
  // date/datetime/uuid/enum-sin-options/string viajan como string (ISO para fechas).
  return { type: "string", description: param.description };
}

function listTool(cap: ResourceCapability): ToolDefinition | null {
  const list = cap.list;
  if (!list) return null;
  const localProps: Record<string, PropSchema> = {
    limit: { type: "integer", description: "Máximo de elementos (1-100).", minimum: 1, maximum: 100 },
    offset: { type: "integer", description: "Desplazamiento para paginar.", minimum: 0 },
  };
  const wireProps: Record<string, Record<string, unknown>> = {
    limit: { type: "integer", description: "Máximo de elementos (1-100)." },
    offset: { type: "integer", description: "Desplazamiento para paginar." },
  };
  const params = filterParams(list);
  for (const param of params) {
    const prop = filterProp(param);
    localProps[param.name] = prop;
    wireProps[param.name] = { ...prop };
  }
  const paramNames = params.map((param) => param.name);
  return {
    name: `resource.list_${cap.name}`,
    description: `Lista ${cap.label} con filtros del contrato (lectura).`,
    kind: "read",
    inputSchema: { type: "object", properties: localProps, required: [], additionalProperties: false },
    wireSchema: { type: "object", properties: wireProps, required: [], additionalProperties: false },
    execute: (args, ctx) => {
      const params = new URLSearchParams();
      if (typeof args.limit === "number") params.set("limit", String(args.limit));
      if (typeof args.offset === "number") params.set("offset", String(args.offset));
      for (const name of paramNames) {
        const value = args[name];
        if (value !== undefined && value !== null && value !== "") params.set(name, String(value));
      }
      const qs = params.toString();
      return ctx.api(`${cap.api_path}${qs ? `?${qs}` : ""}`);
    },
  };
}

function actionTool(cap: ResourceCapability, action: ResourceActionCapability): ToolDefinition {
  const reference = cap.item_reference;
  const needsId = action.scope === "item";
  const fields = action.input_schema?.fields ?? [];
  const fixedBody = action.request?.fixed_body ?? null;
  const extras: ExtraProp[] = needsId ? [idExtra(cap.label)] : [];
  const { inputSchema, wireSchema } = buildSchemas(fields, extras);
  return {
    name: `resource.action_${cap.name}_${action.name}`,
    description: `${action.label} sobre ${cap.label}${action.danger ? " (acción sensible)" : ""}.`,
    kind: "write",
    inputSchema,
    wireSchema,
    approval: {
      actionType: `action_${cap.name}_${action.name}`,
      targetResource: cap.name,
      preauthorized: true,
      summarize: () => `${action.label} en ${cap.label}.`,
    },
    execute: (args, ctx) => {
      const url =
        needsId && reference
          ? fillPlaceholder(action.url_template, reference.placeholder, String(args.id ?? ""))
          : action.url_template;
      // Cuerpo: fixed_body si el contrato lo fija; si no, el allowlist de los campos de la acción.
      const body = fixedBody ?? buildPayload(fields, args);
      return ctx.api(url, { method: action.method, body });
    },
  };
}

// --- Precedencia: ¿una tool hand-written ya cubre (recurso, operación)? ---

function singularize(token: string): string {
  return token.endsWith("s") ? token.slice(0, -1) : token;
}

/** Operaciones de escritura ya cubiertas por tools curadas (de su metadata de aprobación). */
function claimedWrites(existing: readonly ToolDefinition[]): Set<string> {
  const claimed = new Set<string>();
  for (const tool of existing) {
    const meta = tool.approval;
    if (!meta) continue;
    const op = meta.actionType.startsWith("create_")
      ? "create"
      : meta.actionType.startsWith("update_")
        ? "update"
        : null;
    if (op) claimed.add(`${meta.targetResource}|${op}`);
  }
  return claimed;
}

/** ¿Hay una tool curada de lectura (list_/get_) para este recurso? Heurística por nombre. */
function claimsRead(existing: readonly ToolDefinition[], resource: string, op: "list" | "get"): boolean {
  const target = singularize(resource);
  const re = new RegExp(`(^|[._])${op}_([a-z0-9_]+)$`);
  for (const tool of existing) {
    const match = re.exec(tool.name);
    if (match && singularize(match[2]) === target) return true;
  }
  return false;
}

/**
 * Deriva el conjunto de tools genéricas del catálogo del contrato, omitiendo las que ya cubre una
 * tool hand-written (precedencia de las curadas). `existing` es el set curado (p. ej. `listTools()`).
 */
export function deriveResourceTools(
  catalog: ResourceCatalog,
  existing: readonly ToolDefinition[] = [],
): ToolDefinition[] {
  const writes = claimedWrites(existing);
  const tools: ToolDefinition[] = [];

  for (const cap of catalog) {
    if (!cap || cap.view !== "table") continue;

    const create = cap.forms?.create;
    if (create && !writes.has(`${cap.name}|create`)) {
      const tool = createTool(cap, create);
      if (tool) tools.push(tool);
    }

    const update = cap.forms?.update;
    if (update && !writes.has(`${cap.name}|update`)) {
      const tool = updateTool(cap, update);
      if (tool) tools.push(tool);
    }

    if (cap.list && !claimsRead(existing, cap.name, "list")) {
      const tool = listTool(cap);
      if (tool) tools.push(tool);
    }

    if (cap.detail && cap.item_reference && !claimsRead(existing, cap.name, "get")) {
      const tool = getTool(cap);
      if (tool) tools.push(tool);
    }

    for (const action of cap.actions ?? []) {
      tools.push(actionTool(cap, action));
    }
  }

  return tools;
}
