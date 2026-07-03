import type {
  FieldValueType,
  ResourceCapability,
  ResourceFilterOption,
  WidgetType,
} from "@/core/api/contracts";
import { resolveRelationTarget } from "@/core/resources/relation-picker";

/**
 * Modelo de presentación de la página de DETALLE de solo lectura (último hueco de cobertura
 * del frontend; ver ``docs/frontend-coverage-audit.md``). Reusa EXACTAMENTE la misma metadata
 * de capability que el formulario de edición (campos + widgets) para mostrar cada valor en su
 * forma de lectura, sin un solo input: el detalle nunca muta nada.
 *
 * Mecanismo genérico (no por pantalla): cualquier recurso ``table`` con ``detail`` obtiene la
 * vista a partir de su contrato; aquí no hay reglas hardcodeadas por recurso.
 */

const DASH = "—";

/** Campo a mostrar, normalizado desde el contrato (formulario o, en su defecto, lista). */
export type DisplayField = {
  name: string;
  label: string;
  description?: string | null;
  type: FieldValueType;
  /** Widget declarado por el formulario; ``null`` si el campo proviene sólo de la lista. */
  widget?: WidgetType | null;
  /** Opciones cerradas (enum/select); ``null`` si no aplica. */
  options?: ResourceFilterOption[] | null;
};

/**
 * Cómo se PINTA un campo en lectura. Ninguno de estos modos emite un control editable: el
 * renderer sólo produce texto (o un enlace para ``relation``/descarga), garantizando que la
 * página de detalle no contiene inputs.
 */
export type DisplayKind =
  | "text"
  | "boolean"
  | "number"
  | "date"
  | "datetime"
  | "time"
  | "select"
  | "relation";

/**
 * Campos a mostrar en el detalle. El detalle debe mostrar TODOS los campos del registro, no sólo
 * los editables: por eso se UNE el formulario de creación con el de actualización (dedup por
 * nombre, conservando el orden: primero los de creación, luego los que sólo aparezcan en update).
 * El de creación aporta los campos INMUTABLES (p. ej. ``patient_id``, que update omite porque no
 * se reasigna) — sin esta unión la FK del paciente nunca se vería. Se descartan los campos
 * ``password`` (nunca tienen un valor legible en lectura). Si no hay formularios (rol de sólo
 * lectura), cae a los campos de la lista (sin widget: se pinta por ``type``).
 */
export function displayFields(capability: ResourceCapability): DisplayField[] {
  const forms = capability.forms;
  const create = forms?.create?.fields ?? [];
  const update = forms?.update?.fields ?? [];
  if (create.length > 0 || update.length > 0) {
    const byName = new Map<string, DisplayField>();
    for (const field of [...create, ...update]) {
      if (field.widget === "password" || byName.has(field.name)) {
        continue;
      }
      byName.set(field.name, {
        name: field.name,
        label: field.label,
        description: field.description ?? null,
        type: field.type,
        widget: field.widget ?? null,
        options: field.options ?? null,
      });
    }
    return [...byName.values()];
  }
  const list = capability.list;
  if (list) {
    return list.fields.map((field) => ({
      name: field.name,
      label: field.label,
      description: field.description ?? null,
      type: field.type,
      widget: null,
      options: null,
    }));
  }
  return [];
}

/**
 * Modo de pintado de un campo. Un campo FK (``text`` cuyo nombre resuelve a un recurso destino)
 * se pinta como ``relation`` (etiqueta humana), igual que el formulario lo convierte en selector.
 * Si hay widget se usa éste; si no, se deriva del ``type`` declarado.
 */
export function fieldDisplayKind(field: DisplayField): DisplayKind {
  const widget = field.widget;
  if (widget === "text" || (widget == null && field.type === "uuid")) {
    if (resolveRelationTarget(field.name)) {
      return "relation";
    }
  }
  if (widget) {
    switch (widget) {
      case "switch":
        return "boolean";
      case "select":
      case "multiselect":
        return "select";
      case "number":
        return "number";
      case "date":
      case "daterange":
        return "date";
      case "datetime":
        return "datetime";
      case "time":
        return "time";
      case "text":
      case "email":
      case "password":
      case "textarea":
        return "text";
    }
  }
  switch (field.type) {
    case "boolean":
      return "boolean";
    case "integer":
    case "decimal":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "time":
      return "time";
    case "enum":
      return "select";
    default:
      return "text";
  }
}

function safeText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return String(value);
  return DASH;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ONLY = /^\d{2}:\d{2}/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

// Determinista en UTC explícito; nunca zona local del navegador/contenedor (consistente con la
// celda de la lista, ``format-cell``).
function formatDateTime(value: unknown): string {
  if (typeof value !== "string") return DASH;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return DASH;
  const date = new Date(ms);
  const ymd = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const hm = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  return `${ymd} ${hm} UTC`;
}

function selectLabel(field: DisplayField, value: unknown): string {
  const raw = typeof value === "string" || typeof value === "number" ? String(value) : null;
  if (raw == null) return DASH;
  const match = (field.options ?? []).find((option) => option.value === raw);
  return match ? match.label : raw;
}

/**
 * Texto de LECTURA de un valor según su campo. Devuelve siempre un string (React lo escapa);
 * nunca lanza ni produce HTML. El modo ``relation`` se resuelve aparte (etiqueta async vía
 * ``fetchRelationItem``), así que aquí cae a su UUID como respaldo honesto.
 */
/**
 * ``true`` si el valor ya formateado NO aporta información (vacío o el guion largo de "sin dato").
 * Sirve para OMITIR el campo en vistas donde no queremos dejar el "—" (p. ej. Datos generales).
 */
export function isBlankDisplay(formatted: string): boolean {
  return formatted.trim() === "" || formatted === DASH;
}

export function formatDisplayValue(field: DisplayField, value: unknown): string {
  if (value === null || value === undefined) {
    return DASH;
  }
  switch (fieldDisplayKind(field)) {
    case "boolean":
      return typeof value === "boolean" ? (value ? "Sí" : "No") : DASH;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? String(value) : safeText(value);
    case "date": {
      // "YYYY-MM-DD" tal cual (mostrarlo evita el desplazamiento de día por zona horaria).
      const text = typeof value === "string" ? value.slice(0, 10) : "";
      return DATE_ONLY.test(text) ? text : DASH;
    }
    case "datetime":
      return formatDateTime(value);
    case "time": {
      const text = typeof value === "string" ? value : "";
      return TIME_ONLY.test(text) ? text.slice(0, 5) : safeText(value);
    }
    case "select":
      return selectLabel(field, value);
    case "relation":
    case "text":
    default:
      return safeText(value);
  }
}
