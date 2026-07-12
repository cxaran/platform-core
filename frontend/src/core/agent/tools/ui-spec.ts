// Generación de UI declarativa (B9, Parte B). El modelo emite una ESPECIFICACION JSON
// que el panel mapea a componentes React seguros (primitivos R2). NUNCA se inyecta HTML/
// JS crudo del modelo: solo specs validadas y normalizadas aquí.

export type FormFieldType = "text" | "number" | "textarea" | "select";

export interface FormFieldSpec {
  name: string;
  label: string;
  type: FormFieldType;
  placeholder?: string;
  required?: boolean;
  options?: { label: string; value: string }[];
  /** Valor inicial (prellenado) del campo, p. ej. al crear con datos ya proporcionados. */
  value?: string;
}

export interface FormSpec {
  kind: "form";
  title?: string;
  description?: string;
  fields: FormFieldSpec[];
  submit_label: string;
  submit_prompt: string;
}

/**
 * Formulario de un RECURSO del contrato (Camino A) montado en el chat. A diferencia de `FormSpec`
 * (formulario ad-hoc que el modelo describe campo a campo), aquí el agente sólo nombra el recurso y
 * el modo; el FORMULARIO lo deriva el frontend del contrato `/resources` (campos, validaciones,
 * allowlist) y, en particular, las RELACIONES (FK como patient_id/doctor_id) se renderizan como
 * BUSCADORES por nombre — el usuario nunca teclea UUIDs. Al guardar escribe directo por la API del
 * recurso (RBAC server-side) y devuelve una nota de contexto al hilo; no obliga al modelo a invocar
 * la tool de escritura. `values` PRELLENA con datos ya dados; `resource_id` es obligatorio en update.
 */
export interface ResourceFormSpec {
  kind: "resource_form";
  resource: string;
  mode: "create" | "update";
  title?: string;
  /** Requerido en modo "update": id del registro a editar (resuelve detalle + URL de mutación). */
  resource_id?: string;
  /** Prellenado: pares campo→valor con los datos ya proporcionados (p. ej. el nombre). */
  values?: Record<string, string>;
}

export interface ChartDatum {
  label: string;
  value: number;
}

/** Serie de datos (multi-serie: p. ej. sistólica vs diastólica sobre el mismo eje temporal). */
export interface ChartSeries {
  /** Nombre de la serie para la leyenda; opcional en serie única. */
  name?: string;
  data: ChartDatum[];
}

/**
 * Rango de referencia (banda normal). El renderer sombrea la banda y RESALTA en rojo los
 * puntos que caen fuera de ella. Sirve para labs/vitales (p. ej. glucosa 70–100 mg/dL).
 */
export interface ChartReferenceRange {
  low?: number;
  high?: number;
  /** Etiqueta de la banda (si falta, el renderer arma una a partir de low/high). */
  label?: string;
}

/**
 * Tipos de gráfico soportados:
 *  - ``bar``/``line``/``area``: comparación o TENDENCIA numérica (usan data/series {label,value}).
 *  - ``pie``/``doughnut``: PROPORCIONES de una sola serie (distribución de categorías).
 *  - ``gantt``: LÍNEA DE TIEMPO por filas (usan ``tasks`` con start/end); p. ej. plan de cuidados,
 *    cursos de tratamiento, órdenes programadas.
 */
export type ChartType = "bar" | "line" | "area" | "pie" | "doughnut" | "gantt";

/** Fila de una línea de tiempo (chart_type "gantt"): una barra entre dos fechas. */
export interface GanttTask {
  label: string;
  /** Fecha de inicio (ISO, p. ej. "2026-01-05"). */
  start: string;
  /** Fecha de fin (ISO); no puede ser anterior a ``start``. */
  end: string;
  /** Estado que colorea la barra (opcional). */
  status?: "done" | "active" | "planned";
}

export interface ChartSpec {
  kind: "chart";
  chart_type: ChartType;
  title?: string;
  /** Unidad de los valores (p. ej. "mmHg", "mg/dL", "kg"); se muestra junto al título y el eje. */
  unit?: string;
  /** Banda de referencia (bar/line/area): sombrea el rango normal y marca los fuera de él. */
  reference_range?: ChartReferenceRange;
  /** Serie ÚNICA (retrocompat + azúcar). Si viene ``series``, ésta manda. Base de pie/doughnut. */
  data?: ChartDatum[];
  /** MULTI-serie (o serie única con nombre). Canónico para líneas/áreas comparativas. */
  series?: ChartSeries[];
  /** Filas de la línea de tiempo cuando chart_type === "gantt". */
  tasks?: GanttTask[];
}

export type ButtonAction =
  | { type: "message"; prompt: string }
  | { type: "tool"; tool: string; args?: Record<string, unknown> }
  // Enlace de CONTACTO externo (p. ej. abrir WhatsApp con un texto). No muta el sistema; al hacer
  // clic abre la URL en otra pestaña. La URL se valida con `isSafeButtonUrl` (lista blanca estricta).
  | { type: "link"; url: string };

/**
 * ¿La URL de un botón de enlace es segura para abrirse desde la UI generada por el modelo? Lista
 * blanca ESTRICTA de canales de contacto: WhatsApp (wa.me / api.whatsapp.com), teléfono, correo y
 * SMS. Se rechaza todo lo demás (http inseguro, dominios arbitrarios, javascript:/data:) para no
 * abrir vías de phishing/exfiltración desde la salida del modelo.
 */
export function isSafeButtonUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const scheme = parsed.protocol.toLowerCase();
  if (scheme === "tel:" || scheme === "mailto:" || scheme === "sms:") {
    return true;
  }
  if (scheme === "https:") {
    const host = parsed.hostname.toLowerCase();
    return host === "wa.me" || host === "api.whatsapp.com";
  }
  return false;
}

// Clasificación de gobierno de un botón (MP-CTRL-0130). La estructura Y la resolución las calcula
// button-actions.ts (buildButtonsModel: catálogo + RBAC). "read_only" = no puede mutar (mensaje o
// tool de lectura); "actionable" = dispara una tool de escritura resuelta que pasa por la
// aprobación P1; "blocked" = no se permite.
export type ButtonGovernance = "read_only" | "actionable" | "blocked";

export interface ButtonSpec {
  label: string;
  action: ButtonAction;
  /** Clasificación de gobierno (la fija el seam button-actions; ausente = sin resolver aún). */
  governance?: ButtonGovernance;
  /** Motivo cuando el botón queda bloqueado (tool desconocida / sin permiso); si no, ausente. */
  reason?: string;
  /** Argumentos propuestos descartados por estar fuera del esquema de la tool (no se inventan). */
  dropped_args?: string[];
}

export interface ButtonsSpec {
  kind: "buttons";
  title?: string;
  buttons: ButtonSpec[];
}

/**
 * RESPUESTAS SUGERIDAS (quick replies): el agente propone las posibles SIGUIENTES respuestas del
 * usuario como chips bajo su mensaje. Al hacer clic, el texto elegido se envía AUTOMÁTICAMENTE como
 * mensaje del usuario (un turno normal) y los chips se contraen (interfaz de un solo uso; además
 * caducan al enviar cualquier otro mensaje). Sólo texto plano: nunca ejecutan tools ni escriben.
 */
export interface SuggestedRepliesSpec {
  kind: "suggested_replies";
  title?: string;
  replies: string[];
}

// Unión de specs de UI declarativa de la plataforma base: formularios (ad-hoc y de recurso),
// gráficos, botones y respuestas sugeridas. Los specs más elaborados (dynamic_form, wizard,
// task_plan, record_update, open_record…) se integrarán en una rebanada posterior a esta misma
// unión y se pintarán dentro de `GeneratedUi`, sin un renderizador paralelo.
export type UiSpec =
  | FormSpec
  | ResourceFormSpec
  | ChartSpec
  | ButtonsSpec
  | SuggestedRepliesSpec;

export type ParseResult<T> = { ok: true; spec: T } | { ok: false; error: string };

export function isUiSpec(value: unknown): value is UiSpec {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === "form" ||
    kind === "resource_form" ||
    kind === "chart" ||
    kind === "buttons" ||
    kind === "suggested_replies"
  );
}

const MAX_FIELDS = 30;
const MAX_DATA_POINTS = 60;
const MAX_SERIES = 4;
const MAX_REPLIES = 6;
const MAX_REPLY_LENGTH = 140;
const ALLOWED_FIELD_TYPES: FormFieldType[] = ["text", "number", "textarea", "select"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function parseFormSpec(input: unknown): ParseResult<FormSpec> {
  if (!isObject(input)) {
    return { ok: false, error: "La especificación del formulario debe ser un objeto." };
  }
  if (!Array.isArray(input.fields) || input.fields.length === 0) {
    return { ok: false, error: "El formulario debe declarar al menos un campo en 'fields'." };
  }
  if (input.fields.length > MAX_FIELDS) {
    return { ok: false, error: `Demasiados campos (máximo ${MAX_FIELDS}).` };
  }

  const fields: FormFieldSpec[] = [];
  for (const raw of input.fields) {
    if (!isObject(raw)) {
      return { ok: false, error: "Cada campo debe ser un objeto." };
    }
    const name = asString(raw.name);
    const label = asString(raw.label) ?? name;
    const type = (asString(raw.type) ?? "text") as FormFieldType;
    if (!name) {
      return { ok: false, error: "Cada campo requiere 'name'." };
    }
    if (!ALLOWED_FIELD_TYPES.includes(type)) {
      return { ok: false, error: `Tipo de campo no permitido: ${type}.` };
    }
    const field: FormFieldSpec = { name, label: label ?? name, type };
    const placeholder = asString(raw.placeholder);
    if (placeholder) field.placeholder = placeholder;
    if (raw.required === true) field.required = true;
    // Valor inicial (prellenado): permite renderizar el formulario ya con los datos que el usuario
    // proporcionó (p. ej. el nombre al crear un registro), en vez de pedirlos por texto.
    const value = asString(raw.value);
    if (value !== undefined) field.value = value;
    if (type === "select") {
      if (!Array.isArray(raw.options) || raw.options.length === 0) {
        return { ok: false, error: `El campo select '${name}' requiere 'options'.` };
      }
      const options: { label: string; value: string }[] = [];
      for (const opt of raw.options) {
        if (!isObject(opt)) {
          return { ok: false, error: `Opciones inválidas en '${name}'.` };
        }
        const value = asString(opt.value);
        if (value === undefined) {
          return { ok: false, error: `Cada opción de '${name}' requiere 'value'.` };
        }
        options.push({ value, label: asString(opt.label) ?? value });
      }
      field.options = options;
    }
    fields.push(field);
  }

  return {
    ok: true,
    spec: {
      kind: "form",
      ...(asString(input.title) ? { title: asString(input.title) } : {}),
      ...(asString(input.description) ? { description: asString(input.description) } : {}),
      fields,
      submit_label: asString(input.submit_label) ?? "Enviar",
      submit_prompt: asString(input.submit_prompt) ?? asString(input.title) ?? "Formulario enviado",
    },
  };
}

export function parseResourceFormSpec(input: unknown): ParseResult<ResourceFormSpec> {
  if (!isObject(input)) {
    return { ok: false, error: "La especificación del formulario de recurso debe ser un objeto." };
  }
  const resource = asString(input.resource);
  if (!resource) {
    return { ok: false, error: "Se requiere 'resource' (nombre del recurso del contrato)." };
  }
  const mode = asString(input.mode) ?? "create";
  if (mode !== "create" && mode !== "update") {
    return { ok: false, error: "El 'mode' debe ser 'create' o 'update'." };
  }
  const resourceId = asString(input.resource_id);
  if (mode === "update" && !resourceId) {
    return { ok: false, error: "El modo 'update' requiere 'resource_id'." };
  }
  // Prellenado: sólo valores escalares (string/number/boolean) → string. Se descarta lo demás (no se
  // inventan estructuras); los campos fuera del esquema los filtra después el formulario del contrato.
  const values: Record<string, string> = {};
  if (isObject(input.values)) {
    for (const [key, raw] of Object.entries(input.values)) {
      if (typeof raw === "string") {
        values[key] = raw;
      } else if (typeof raw === "number" || typeof raw === "boolean") {
        values[key] = String(raw);
      }
    }
  }

  const spec: ResourceFormSpec = { kind: "resource_form", resource, mode };
  const title = asString(input.title);
  if (title) spec.title = title;
  if (resourceId) spec.resource_id = resourceId;
  if (Object.keys(values).length > 0) spec.values = values;
  return { ok: true, spec };
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Valida el arreglo de puntos de una serie ({label, value} numérico, con tope). */
function parseChartData(raw: unknown): ParseResult<ChartDatum[]> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "La serie requiere 'data' con al menos un punto." };
  }
  if (raw.length > MAX_DATA_POINTS) {
    return { ok: false, error: `Demasiados puntos (máximo ${MAX_DATA_POINTS}).` };
  }
  const data: ChartDatum[] = [];
  for (const point of raw) {
    if (!isObject(point)) {
      return { ok: false, error: "Cada punto del gráfico debe ser un objeto." };
    }
    const label = asString(point.label);
    if (label === undefined) {
      return { ok: false, error: "Cada punto requiere 'label'." };
    }
    const value = asFiniteNumber(point.value);
    if (value === undefined) {
      return { ok: false, error: `El punto '${label}' requiere un 'value' numérico.` };
    }
    data.push({ label, value });
  }
  return { ok: true, spec: data };
}

/** Valida el rango de referencia opcional (al menos low o high; low ≤ high si ambos). */
function parseReferenceRange(raw: unknown): ParseResult<ChartReferenceRange | undefined> {
  if (raw === undefined || raw === null) {
    return { ok: true, spec: undefined };
  }
  if (!isObject(raw)) {
    return { ok: false, error: "'reference_range' debe ser un objeto { low?, high?, label? }." };
  }
  const low = asFiniteNumber(raw.low);
  const high = asFiniteNumber(raw.high);
  if (low === undefined && high === undefined) {
    return { ok: false, error: "'reference_range' requiere 'low' y/o 'high' numéricos." };
  }
  if (low !== undefined && high !== undefined && low > high) {
    return { ok: false, error: "'reference_range': 'low' no puede ser mayor que 'high'." };
  }
  const range: ChartReferenceRange = {};
  if (low !== undefined) range.low = low;
  if (high !== undefined) range.high = high;
  const label = asString(raw.label);
  if (label) range.label = label;
  return { ok: true, spec: range };
}

const CHART_TYPES: ChartType[] = ["bar", "line", "area", "pie", "doughnut", "gantt"];
const GANTT_STATUSES: NonNullable<GanttTask["status"]>[] = ["done", "active", "planned"];

/** Valida las filas de una línea de tiempo (gantt): label + fechas start ≤ end + estado opcional. */
function parseGanttTasks(raw: unknown): ParseResult<GanttTask[]> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "El gantt requiere 'tasks' con al menos una fila." };
  }
  if (raw.length > MAX_DATA_POINTS) {
    return { ok: false, error: `Demasiadas tareas (máximo ${MAX_DATA_POINTS}).` };
  }
  const tasks: GanttTask[] = [];
  for (const raw_task of raw) {
    if (!isObject(raw_task)) {
      return { ok: false, error: "Cada tarea del gantt debe ser un objeto." };
    }
    const label = asString(raw_task.label);
    const start = asString(raw_task.start);
    const end = asString(raw_task.end);
    if (label === undefined) {
      return { ok: false, error: "Cada tarea requiere 'label'." };
    }
    if (start === undefined || Number.isNaN(Date.parse(start))) {
      return { ok: false, error: `La tarea '${label}' requiere 'start' con fecha válida (ISO).` };
    }
    if (end === undefined || Number.isNaN(Date.parse(end))) {
      return { ok: false, error: `La tarea '${label}' requiere 'end' con fecha válida (ISO).` };
    }
    if (Date.parse(end) < Date.parse(start)) {
      return { ok: false, error: `La tarea '${label}': 'end' no puede ser anterior a 'start'.` };
    }
    const task: GanttTask = { label, start, end };
    const status = asString(raw_task.status);
    if (status !== undefined) {
      if (!GANTT_STATUSES.includes(status as GanttTask["status"] & string)) {
        return { ok: false, error: `Estado inválido en '${label}' (done | active | planned).` };
      }
      task.status = status as GanttTask["status"];
    }
    tasks.push(task);
  }
  return { ok: true, spec: tasks };
}

export function parseChartSpec(input: unknown): ParseResult<ChartSpec> {
  if (!isObject(input)) {
    return { ok: false, error: "La especificación del gráfico debe ser un objeto." };
  }
  const chartType = (asString(input.chart_type) ?? "bar") as ChartType;
  if (!CHART_TYPES.includes(chartType)) {
    return { ok: false, error: "chart_type debe ser bar | line | area | pie | doughnut | gantt." };
  }

  const reference = parseReferenceRange(input.reference_range);
  if (!reference.ok) {
    return reference;
  }

  const base: ChartSpec = { kind: "chart", chart_type: chartType };
  const title = asString(input.title);
  if (title) base.title = title;
  const unit = asString(input.unit);
  if (unit) base.unit = unit;
  if (reference.spec) base.reference_range = reference.spec;

  // LÍNEA DE TIEMPO: gantt usa 'tasks' (fechas), no data/series.
  if (chartType === "gantt") {
    const parsed = parseGanttTasks(input.tasks);
    if (!parsed.ok) {
      return parsed;
    }
    return { ok: true, spec: { ...base, tasks: parsed.spec } };
  }

  // MULTI-serie: si viene 'series', manda; si no, cae a 'data' (serie única, retrocompat).
  if (input.series !== undefined) {
    if (!Array.isArray(input.series) || input.series.length === 0) {
      return { ok: false, error: "'series' debe ser un arreglo con al menos una serie." };
    }
    if (input.series.length > MAX_SERIES) {
      return { ok: false, error: `Demasiadas series (máximo ${MAX_SERIES}).` };
    }
    const series: ChartSeries[] = [];
    for (const rawSeries of input.series) {
      if (!isObject(rawSeries)) {
        return { ok: false, error: "Cada serie debe ser un objeto { name?, data }." };
      }
      const parsed = parseChartData(rawSeries.data);
      if (!parsed.ok) {
        return parsed;
      }
      const one: ChartSeries = { data: parsed.spec };
      const name = asString(rawSeries.name);
      if (name) one.name = name;
      series.push(one);
    }
    return { ok: true, spec: { ...base, series } };
  }

  const parsed = parseChartData(input.data);
  if (!parsed.ok) {
    return parsed;
  }
  return { ok: true, spec: { ...base, data: parsed.spec } };
}

// La validación de botones (estructura + gobernanza) vive en button-actions.ts
// (``buildButtonsModel``): el parser estructural que vivía aquí quedó superado y se retiró.

/**
 * Valida la spec de RESPUESTAS SUGERIDAS. Sólo texto plano corto (los chips se envían como mensaje
 * del usuario al hacer clic); se descartan entradas vacías/duplicadas y se acota cantidad y largo
 * para que la interfaz no degenere en un menú interminable.
 */
export function parseSuggestedRepliesSpec(input: unknown): ParseResult<SuggestedRepliesSpec> {
  if (!isObject(input)) {
    return { ok: false, error: "La especificación de respuestas sugeridas debe ser un objeto." };
  }
  if (!Array.isArray(input.replies) || input.replies.length === 0) {
    return { ok: false, error: "Se requiere al menos una respuesta en 'replies'." };
  }
  if (input.replies.length > MAX_REPLIES) {
    return { ok: false, error: `Demasiadas respuestas sugeridas (máximo ${MAX_REPLIES}).` };
  }
  const replies: string[] = [];
  for (const raw of input.replies) {
    if (typeof raw !== "string") {
      return { ok: false, error: "Cada respuesta sugerida debe ser texto." };
    }
    const reply = raw.trim();
    if (!reply) {
      return { ok: false, error: "Las respuestas sugeridas no pueden estar vacías." };
    }
    if (reply.length > MAX_REPLY_LENGTH) {
      return {
        ok: false,
        error: `Cada respuesta sugerida debe tener como máximo ${MAX_REPLY_LENGTH} caracteres.`,
      };
    }
    if (!replies.includes(reply)) {
      replies.push(reply);
    }
  }
  return {
    ok: true,
    spec: {
      kind: "suggested_replies",
      ...(asString(input.title) ? { title: asString(input.title) } : {}),
      replies,
    },
  };
}

/**
 * Mensaje de seguimiento al enviar un formulario generado: el envío continúa la
 * conversación con el modelo (no escribe nada por sí mismo; si el modelo decide una
 * acción del negocio de escritura, pasa por la aprobación de B8).
 */
export function buildFormSubmissionMessage(spec: FormSpec, values: Record<string, string>): string {
  const lines = spec.fields.map((field) => `- ${field.label}: ${values[field.name] ?? ""}`);
  return `${spec.submit_prompt}\n${lines.join("\n")}`;
}

/** Traduce la acción de un botón generado a un mensaje de seguimiento para el modelo. */
export function buttonActionToMessage(action: ButtonAction): string {
  if (action.type === "message") {
    return action.prompt;
  }
  // Los enlaces se abren directamente en el render (no continúan la conversación); este texto es un
  // respaldo defensivo y no debería usarse en el flujo normal.
  if (action.type === "link") {
    return action.url;
  }
  const argsText = action.args ? ` con argumentos ${JSON.stringify(action.args)}` : "";
  return `Usa la herramienta ${action.tool}${argsText}.`;
}
