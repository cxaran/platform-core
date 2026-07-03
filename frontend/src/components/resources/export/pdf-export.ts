import type { ExportCell, ExportColumn } from "./build-export-rows";
import { numericColumnIndexes } from "./build-export-rows";

/**
 * Generador de PDF (jsPDF + autotable), portado del patrón de DynamicTable:
 * bloque de título con regla, metadatos (generado + total), caja para el
 * encabezado institucional, estilos de tabla configurables, números a la
 * derecha, pie institucional con salto de página y "Página X de Y" en cada
 * hoja. Las librerías se cargan con import() dinámico; el mismo documento
 * alimenta la VISTA PREVIA (bloburl → iframe) y la descarga.
 */

/** Tamaños de página soportados (nombres que jsPDF entiende como ``format``). */
export type PdfPageSize = "a4" | "letter" | "legal";

export type PdfConfig = {
  title: string;
  orientation: "portrait" | "landscape";
  /** Tamaño de hoja; por omisión A4 (comportamiento previo). "letter" = Carta, "legal" = Oficio. */
  pageSize?: PdfPageSize;
  fontSize: number;
  tableStyle: "striped" | "grid" | "plain";
  headerText?: string;
  footerText?: string;
  generatedAt: Date;
  totalRows: number;
};

type Rgb = [number, number, number];

const PALETTE = {
  text: [45, 45, 45] as Rgb,
  muted: [110, 120, 140] as Rgb,
  primary: [33, 33, 33] as Rgb,
  border: [220, 224, 230] as Rgb,
  surface: [247, 249, 252] as Rgb,
  zebra: [243, 246, 250] as Rgb,
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

async function buildDoc(
  config: PdfConfig,
  columns: readonly ExportColumn[],
  cellRows: readonly (readonly ExportCell[])[],
) {
  const [{ default: JsPdf }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new JsPdf({
    orientation: config.orientation,
    unit: "mm",
    format: config.pageSize ?? "a4",
  });
  const marginLeft = 14;
  const pageWidth = doc.internal.pageSize.getWidth();
  const usableWidth = pageWidth - marginLeft * 2;
  let cursorY = 22;

  const title = config.title.trim() === "" ? "Tabla de datos" : config.title.trim();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...PALETTE.primary);
  doc.text(title, marginLeft, cursorY);
  doc.setDrawColor(...PALETTE.border);
  doc.setLineWidth(0.5);
  doc.line(marginLeft, cursorY + 3, marginLeft + usableWidth, cursorY + 3);

  cursorY += 9;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...PALETTE.muted);
  const at = config.generatedAt;
  const printedAt = `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  doc.text(`Generado: ${printedAt}`, marginLeft, cursorY);
  doc.text(`Total de registros: ${config.totalRows}`, marginLeft + usableWidth, cursorY, {
    align: "right",
  });
  doc.setTextColor(...PALETTE.text);
  cursorY += 6;

  if (config.headerText && config.headerText.trim() !== "") {
    const lines = doc.splitTextToSize(config.headerText.trim(), usableWidth);
    doc.setFontSize(9);
    const dims = doc.getTextDimensions(lines);
    const top = cursorY + 8;
    const blockHeight = dims.h + 12;
    doc.setDrawColor(...PALETTE.border);
    doc.setFillColor(...PALETTE.surface);
    doc.roundedRect(marginLeft - 3, top - 8, usableWidth + 6, blockHeight, 2, 2, "F");
    doc.setFillColor(...PALETTE.primary);
    doc.rect(marginLeft - 3, top - 8, 3, blockHeight, "F");
    doc.setTextColor(...PALETTE.text);
    doc.text(lines, marginLeft + 2, top);
    cursorY = top + dims.h + 6;
  } else {
    cursorY += 6;
  }

  const tableStartY = Math.max(cursorY + 10, 46);
  const headers = columns.map((column) => column.label);
  const body = cellRows.map((row) => row.map((cell) => cell.text));

  const numeric = numericColumnIndexes(columns);
  const columnStyles = Object.fromEntries(
    [...numeric].map((index) => [index, { halign: "right" as const }]),
  );

  const basePadding = { top: 4, right: 3, bottom: 4, left: 3 };
  const baseStyles = {
    fontSize: config.fontSize,
    cellPadding: basePadding,
    lineColor: PALETTE.border,
    lineWidth: config.tableStyle === "plain" ? 0 : 0.1,
    textColor: PALETTE.text,
  };

  autoTable(doc, {
    head: [headers],
    body,
    startY: tableStartY,
    styles: baseStyles,
    bodyStyles: { textColor: PALETTE.text, lineColor: PALETTE.border },
    alternateRowStyles:
      config.tableStyle === "striped" ? { fillColor: PALETTE.zebra } : undefined,
    headStyles:
      config.tableStyle === "plain"
        ? {
            fillColor: [245, 245, 245],
            textColor: PALETTE.text,
            fontSize: config.fontSize + 1,
            fontStyle: "bold",
            lineColor: PALETTE.border,
          }
        : {
            fillColor: PALETTE.primary,
            textColor: 255,
            fontSize: config.fontSize + 1,
            fontStyle: "bold",
          },
    columnStyles,
    margin: { left: marginLeft, right: marginLeft },
    tableLineColor: PALETTE.border,
    tableLineWidth: config.tableStyle === "plain" ? 0 : 0.1,
  });

  if (config.footerText && config.footerText.trim() !== "") {
    const lines = doc.splitTextToSize(config.footerText.trim(), usableWidth);
    doc.setFontSize(9);
    const lastTable = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable;
    let footerY = (lastTable?.finalY ?? tableStartY) + 10;
    const dims = doc.getTextDimensions(lines);
    const pageHeight = doc.internal.pageSize.getHeight();
    if (footerY + dims.h > pageHeight - 10) {
      doc.addPage();
      footerY = 20;
    }
    doc.setDrawColor(...PALETTE.border);
    doc.line(marginLeft, footerY - 4, marginLeft + usableWidth, footerY - 4);
    doc.setTextColor(...PALETTE.muted);
    doc.text(lines, marginLeft, footerY);
  }

  const totalPages = doc.getNumberOfPages();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  for (let page = 1; page <= totalPages; page++) {
    doc.setPage(page);
    const width = doc.internal.pageSize.getWidth();
    const height = doc.internal.pageSize.getHeight();
    doc.text(`Página ${page} de ${totalPages}`, width - marginLeft, height - 10, {
      align: "right",
    });
  }
  doc.setPage(1);

  return doc;
}

/** Blob URL para la vista previa en <iframe>; el caller debe revocarla. */
export async function pdfPreviewUrl(
  config: PdfConfig,
  columns: readonly ExportColumn[],
  cellRows: readonly (readonly ExportCell[])[],
): Promise<string> {
  const doc = await buildDoc(config, columns, cellRows);
  return doc.output("bloburl").toString();
}

export async function pdfBlob(
  config: PdfConfig,
  columns: readonly ExportColumn[],
  cellRows: readonly (readonly ExportCell[])[],
): Promise<Blob> {
  const doc = await buildDoc(config, columns, cellRows);
  return doc.output("blob");
}
