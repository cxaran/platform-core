import type { FieldValueType, ResourceListCapability } from "@/core/api/contracts";

import { parseDateTimeMs } from "../format-cell";

/**
 * Módulo PURO compartido del export: convierte filas crudas del contrato en
 * celdas tipadas. Es el ÚNICO mapeo — lo consumen el generador de Excel (tipos
 * nativos), el de PDF y las vistas previas del diálogo, así que lo que se ve en
 * la previsualización es lo que aterriza en el archivo, por construcción.
 * Nunca interpreta HTML ni ejecuta nada del valor crudo.
 */

export type ExportColumn = {
  name: string;
  label: string;
  type: FieldValueType;
};

export type ExportCell =
  | { kind: "empty"; text: "" }
  | { kind: "text"; text: string }
  | { kind: "number"; value: number; text: string }
  | { kind: "boolean"; value: boolean; text: string }
  // value es un Date real (Excel lo guarda como fecha nativa); text es la
  // representación imprimible para PDF/preview.
  | { kind: "date"; value: Date; text: string }
  | { kind: "datetime"; value: Date; text: string };

const EMPTY: ExportCell = { kind: "empty", text: "" };

/** Columnas exportables: las visibles en lista menos las ocultas por el usuario. */
export function exportColumns(
  list: ResourceListCapability,
  hidden: ReadonlySet<string>,
): ExportColumn[] {
  return list.fields
    .filter((field) => field.visible_in_list && !hidden.has(field.name))
    .map((field) => ({ name: field.name, label: field.label, type: field.type }));
}

/**
 * value → label del contrato por columna enum, desde las opciones de los
 * operadores select de ``filterable_fields`` (ResourceFilterOption). Compartido
 * con ResourceTable: una sola fuente para tabla y export.
 */
export function enumLabelMaps(
  list: ResourceListCapability,
): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const maps = new Map<string, Map<string, string>>();
  for (const field of list.filterable_fields ?? []) {
    for (const operator of field.operators ?? []) {
      if (!operator.options || operator.options.length === 0) continue;
      const map = maps.get(field.key) ?? new Map<string, string>();
      for (const option of operator.options) {
        if (option.value && option.label && !map.has(option.value)) {
          map.set(option.value, option.label);
        }
      }
      maps.set(field.key, map);
    }
  }
  return maps;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function textCell(value: string): ExportCell {
  return value === "" ? EMPTY : { kind: "text", text: value };
}

function numberCell(raw: unknown): ExportCell {
  const value =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value)) return textCell(safeText(raw));
  return { kind: "number", value, text: String(value) };
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

// Fecha civil: se construye por partes (nunca Date.parse) para no desplazar el
// día por zona horaria — misma regla que format-cell/LocalDate.
function dateCell(raw: unknown): ExportCell {
  if (typeof raw !== "string") return EMPTY;
  const match = DATE_ONLY.exec(raw);
  if (!match) return EMPTY;
  const [, year, month, day] = match;
  const value = new Date(Number(year), Number(month) - 1, Number(day));
  return { kind: "date", value, text: `${day}/${month}/${year}` };
}

// Instante real (parseDateTimeMs fija UTC en cadenas naive); el texto usa la
// zona LOCAL del navegador, consistente con lo que muestra la tabla.
function dateTimeCell(raw: unknown): ExportCell {
  const ms = parseDateTimeMs(raw);
  if (ms === null) return EMPTY;
  const value = new Date(ms);
  const text = `${pad(value.getDate())}/${pad(value.getMonth() + 1)}/${value.getFullYear()} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
  return { kind: "datetime", value, text };
}

function safeText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return String(value);
  return "";
}

function arrayText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const parts: string[] = [];
  for (const element of value) {
    if (typeof element === "string") parts.push(element);
    else if (typeof element === "number" && Number.isFinite(element)) parts.push(String(element));
    else if (typeof element === "boolean") parts.push(element ? "Sí" : "No");
    else return "";
  }
  return parts.join(", ");
}

export function buildExportCell(
  raw: unknown,
  type: FieldValueType,
  enumLabels?: ReadonlyMap<string, string>,
): ExportCell {
  if (raw === null || raw === undefined) return EMPTY;
  switch (type) {
    case "boolean":
      return typeof raw === "boolean"
        ? { kind: "boolean", value: raw, text: raw ? "Sí" : "No" }
        : EMPTY;
    case "integer":
    case "decimal":
      return numberCell(raw);
    case "date":
      return dateCell(raw);
    case "datetime":
      return dateTimeCell(raw);
    case "enum": {
      const value = safeText(raw);
      return textCell(value === "" ? "" : (enumLabels?.get(value) ?? value));
    }
    case "array":
      return textCell(arrayText(raw));
    default:
      return textCell(safeText(raw));
  }
}

/** Matriz de celdas tipadas, en el orden de ``columns``. */
export function buildExportRows(
  columns: readonly ExportColumn[],
  enumLabels: ReadonlyMap<string, ReadonlyMap<string, string>>,
  rows: readonly Record<string, unknown>[],
): ExportCell[][] {
  return rows.map((row) =>
    columns.map((column) => buildExportCell(row[column.name], column.type, enumLabels.get(column.name))),
  );
}

export function headerLabels(columns: readonly ExportColumn[]): string[] {
  return columns.map((column) => column.label);
}

/** Columnas numéricas (para alinear a la derecha en PDF/preview). */
export function numericColumnIndexes(columns: readonly ExportColumn[]): Set<number> {
  const indexes = new Set<number>();
  columns.forEach((column, index) => {
    if (column.type === "integer" || column.type === "decimal") indexes.add(index);
  });
  return indexes;
}
