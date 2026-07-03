import type { ExportCell, ExportColumn } from "./build-export-rows";

/**
 * Generador de Excel (SheetJS) con TIPOS NATIVOS: fechas como celdas Date con
 * formato, booleanos y números reales — no strings. La librería (~1MB) se carga
 * con import() dinámico sólo al exportar. Encabezado/pie impresos van como
 * filas combinadas, como en el patrón de DynamicTable.
 */

export type ExcelDocumentConfig = {
  title: string;
  headerText?: string;
  footerText?: string;
};

const DATE_FMT = "dd/mm/yyyy";
const DATETIME_FMT = "dd/mm/yyyy hh:mm";

function cellValue(cell: ExportCell): unknown {
  switch (cell.kind) {
    case "number":
    case "boolean":
    case "date":
    case "datetime":
      return cell.value;
    default:
      return cell.text;
  }
}

export async function buildWorkbookBlob(
  config: ExcelDocumentConfig,
  columns: readonly ExportColumn[],
  cellRows: readonly (readonly ExportCell[])[],
): Promise<Blob> {
  const XLSX = await import("xlsx");

  const headers = columns.map((column) => column.label);
  const columnCount = Math.max(headers.length, 1);
  const spanRow = (text?: string) =>
    text && text.trim() !== "" ? [text, ...Array(columnCount - 1).fill("")] : null;

  const sheetRows: unknown[][] = [];
  const headerSpan = spanRow(config.headerText);
  if (headerSpan) sheetRows.push(headerSpan);
  sheetRows.push(headers);
  for (const row of cellRows) {
    sheetRows.push(row.map(cellValue));
  }
  let footerRowIndex: number | null = null;
  const footerSpan = spanRow(config.footerText);
  if (footerSpan) {
    sheetRows.push(Array(columnCount).fill(""));
    sheetRows.push(footerSpan);
    footerRowIndex = sheetRows.length - 1;
  }

  const ws = XLSX.utils.aoa_to_sheet(sheetRows, { cellDates: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Datos");

  const merges: NonNullable<(typeof ws)["!merges"]> = [];
  if (headerSpan) merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: columnCount - 1 } });
  if (footerRowIndex !== null) {
    merges.push({ s: { r: footerRowIndex, c: 0 }, e: { r: footerRowIndex, c: columnCount - 1 } });
  }
  if (merges.length > 0) ws["!merges"] = merges;

  // Formatos por celda de datos según el tipo de la columna.
  const dataStart = (headerSpan ? 1 : 0) + 1;
  for (let r = 0; r < cellRows.length; r++) {
    for (let c = 0; c < columns.length; c++) {
      const cell = cellRows[r][c];
      if (cell.kind !== "date" && cell.kind !== "datetime") continue;
      const address = XLSX.utils.encode_cell({ r: dataStart + r, c });
      const sheetCell = ws[address];
      if (sheetCell) {
        sheetCell.z = cell.kind === "date" ? DATE_FMT : DATETIME_FMT;
      }
    }
  }

  // Anchos automáticos simples (acotados) por el texto imprimible.
  ws["!cols"] = columns.map((_, index) => {
    let max = String(headers[index] ?? "").length;
    for (const row of cellRows) {
      max = Math.max(max, row[index]?.text.length ?? 0);
    }
    return { wch: Math.min(50, Math.max(8, max + 2)) };
  });

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array", cellDates: true });
  return new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportFilename(title: string, extension: string, now: Date): string {
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const safeTitle = title.trim() === "" ? "export" : title.trim().replace(/[\\/:*?"<>|]/g, "-");
  return `${safeTitle}_${stamp}.${extension}`;
}
