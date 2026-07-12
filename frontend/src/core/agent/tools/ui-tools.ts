// Tools transversales `ui.*` de la plataforma base: dejan que el modelo MUESTRE interfaces
// declarativas (formularios, gráficos, respuestas sugeridas) en el chat. Son de LECTURA: no
// mutan nada; su `execute` sólo valida la spec (ui-spec) y la devuelve para que el panel la
// renderice con `GeneratedUi` (nunca HTML/JS crudo del modelo).

import { ToolExecutionError, type ToolDefinition } from "./registry";
import type { ObjectSchema } from "./schema-validator";
import { parseChartSpec, parseFormSpec, parseSuggestedRepliesSpec } from "./ui-spec";

// Esquema local permisivo: la spec anidada la valida el parser de ui-spec en el executor.
const PASSTHROUGH_SCHEMA: ObjectSchema = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: true,
};

const renderFormTool: ToolDefinition = {
  name: "ui.render_form",
  description:
    "Muestra un formulario ad-hoc en el chat para que el usuario complete campos. Declara " +
    "'fields' (name, label, type: text|number|textarea|select, required?, options? para select) " +
    "y 'submit_label'/'submit_prompt'. Al enviar, los valores vuelven como mensaje de seguimiento; " +
    "no escribe nada por sí mismo.",
  kind: "read",
  inputSchema: PASSTHROUGH_SCHEMA,
  wireSchema: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      fields: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            label: { type: "string" },
            type: { type: "string", enum: ["text", "number", "textarea", "select"] },
            placeholder: { type: "string" },
            required: { type: "boolean" },
            value: { type: "string" },
            options: {
              type: "array",
              items: {
                type: "object",
                properties: { label: { type: "string" }, value: { type: "string" } },
                required: ["value"],
              },
            },
          },
          required: ["name", "type"],
        },
      },
      submit_label: { type: "string" },
      submit_prompt: { type: "string" },
    },
    required: ["fields"],
  },
  execute: async (args) => {
    const parsed = parseFormSpec(args);
    if (!parsed.ok) throw new ToolExecutionError("invalid_form_spec", parsed.error);
    return parsed.spec;
  },
};

const renderChartTool: ToolDefinition = {
  name: "ui.render_chart",
  description:
    "Muestra un gráfico en el chat (solo visualización; los datos los provees tú). chart_type: " +
    "'line'/'area' para TENDENCIAS, 'bar' para comparar categorías, 'pie'/'doughnut' para " +
    "PROPORCIONES, 'gantt' para LÍNEAS DE TIEMPO. Serie única data:[{label,value}] o varias " +
    "series:[{name,data:[{label,value}]}] (máx. 4). Añade 'unit' y, opcionalmente, 'reference_range' " +
    "{low?,high?,label?} para sombrear una banda y marcar los puntos fuera de ella. Para 'gantt' usa " +
    "tasks:[{label,start,end,status?}] con fechas ISO (status: done|active|planned).",
  kind: "read",
  inputSchema: PASSTHROUGH_SCHEMA,
  wireSchema: {
    type: "object",
    properties: {
      chart_type: { type: "string", enum: ["bar", "line", "area", "pie", "doughnut", "gantt"] },
      title: { type: "string" },
      unit: { type: "string" },
      reference_range: {
        type: "object",
        properties: {
          low: { type: "number" },
          high: { type: "number" },
          label: { type: "string" },
        },
      },
      data: {
        type: "array",
        items: {
          type: "object",
          properties: { label: { type: "string" }, value: { type: "number" } },
          required: ["label", "value"],
        },
      },
      series: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            data: {
              type: "array",
              items: {
                type: "object",
                properties: { label: { type: "string" }, value: { type: "number" } },
                required: ["label", "value"],
              },
            },
          },
          required: ["data"],
        },
      },
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            start: { type: "string" },
            end: { type: "string" },
            status: { type: "string", enum: ["done", "active", "planned"] },
          },
          required: ["label", "start", "end"],
        },
      },
    },
    required: ["chart_type"],
  },
  execute: async (args) => {
    const parsed = parseChartSpec(args);
    if (!parsed.ok) throw new ToolExecutionError("invalid_chart_spec", parsed.error);
    return parsed.spec;
  },
};

const suggestedRepliesTool: ToolDefinition = {
  name: "ui.suggested_replies",
  description:
    "Ofrece al usuario respuestas rápidas como chips bajo tu mensaje (solo texto plano). Al hacer " +
    "clic, el texto elegido se envía como su siguiente mensaje. Declara 'replies' (máx. 6).",
  kind: "read",
  inputSchema: PASSTHROUGH_SCHEMA,
  wireSchema: {
    type: "object",
    properties: {
      title: { type: "string" },
      replies: { type: "array", items: { type: "string" } },
    },
    required: ["replies"],
  },
  execute: async (args) => {
    const parsed = parseSuggestedRepliesSpec(args);
    if (!parsed.ok) throw new ToolExecutionError("invalid_suggested_replies_spec", parsed.error);
    return parsed.spec;
  },
};

/** Tools `ui.*` transversales de la plataforma base (se registran en `registry.ts`). */
export const BASE_UI_TOOLS: readonly ToolDefinition[] = [
  renderFormTool,
  renderChartTool,
  suggestedRepliesTool,
];
