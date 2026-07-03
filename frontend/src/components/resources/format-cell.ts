import type { FieldValueType } from "@/core/api/contracts";

const DASH = "—";

function safeText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return String(value);
  return DASH;
}

function formatBoolean(value: unknown): string {
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return DASH;
}

// Solo "YYYY-MM-DD": mostrar tal cual evita el desplazamiento de día que produce
// pasar la cadena por ``Date`` (interpretación según zona horaria).
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function formatDate(value: unknown): string {
  if (typeof value === "string" && DATE_ONLY.test(value)) return value;
  return DASH;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

// ¿La cadena declara zona? (sufijo Z o ±hh[:]mm)
const HAS_TIMEZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Parseo de fecha-hora del contrato. El backend serializa UTC "naive" (sin zona) y
 * ``Date.parse`` interpreta las cadenas naive en la zona del ENTORNO — correcto en el
 * server (UTC) pero desplazado en el navegador (record panel). Se fija 'Z' explícito
 * para que el instante sea el mismo en ambos lados.
 */
export function parseDateTimeMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const iso = HAS_TIMEZONE.test(value) ? value : `${value}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

// Determinista en UTC explícito; nunca zona local del navegador/contenedor.
function formatDateTime(value: unknown): string {
  const ms = parseDateTimeMs(value);
  if (ms === null) return DASH;
  const date = new Date(ms);
  const ymd = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const hm = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  return `${ymd} ${hm} UTC`;
}

function formatArray(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return DASH;
  const parts: string[] = [];
  for (const element of value) {
    if (typeof element === "string") {
      parts.push(element);
    } else if (typeof element === "number" && Number.isFinite(element)) {
      parts.push(String(element));
    } else if (typeof element === "boolean") {
      parts.push(element ? "Sí" : "No");
    } else {
      // objeto, array anidado o valor inesperado: no se serializa.
      return DASH;
    }
  }
  return parts.join(", ");
}

/**
 * Convierte un valor crudo de fila en texto seguro según el tipo declarado por la
 * capability. Devuelve siempre un string (React lo escapa al renderizar); nunca
 * lanza ni produce HTML ejecutable.
 */
export function formatCell(value: unknown, type: FieldValueType): string {
  if (value === null || value === undefined) {
    return DASH;
  }

  switch (type) {
    case "boolean":
      return formatBoolean(value);
    case "date":
      return formatDate(value);
    case "datetime":
      return formatDateTime(value);
    case "array":
      return formatArray(value);
    case "string":
    case "email":
    case "uuid":
    case "enum":
    case "integer":
    case "decimal":
      return safeText(value);
    default:
      return safeText(value);
  }
}
