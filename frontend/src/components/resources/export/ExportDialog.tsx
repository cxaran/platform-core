"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import type { ResourceCapability, ResourceListCapability } from "@/core/api/contracts";
import {
  buildFilterableControls,
  parseListQuery,
  type FilterableControls,
  type ResourceListQuery,
} from "@/core/resources/list-query";
import type { FilterableFieldControl } from "@/core/resources/filterable";
import {
  fetchResourceCapability,
  fetchResourceListPage,
} from "@/core/resources/embedded-list-client";

import { FilterEditor } from "../FilterEditor";
import { fieldParameterNames, hiddenColumnsCookieName } from "../filter-nav";
import { useFocusTrap } from "../use-focus-trap";
import {
  buildExportRows,
  enumLabelMaps,
  exportColumns,
  numericColumnIndexes,
  type ExportCell,
  type ExportColumn,
} from "./build-export-rows";
import { buildWorkbookBlob, downloadBlob, exportFilename } from "./excel-export";
import { pdfBlob, pdfPreviewUrl, type PdfConfig, type PdfPageSize } from "./pdf-export";
import { fetchAllRows } from "./export-download";

/**
 * Diálogo de exportación (patrón de DynamicTable, mejorado con el contrato):
 * configuración a la izquierda y VISTA PREVIA EN VIVO a la derecha — el PDF se
 * regenera con debounce en un iframe (bloburl de jsPDF) y el Excel se
 * previsualiza como hoja HTML construida con EL MISMO módulo de celdas que
 * genera el archivo. Los filtros del alcance se editan con los operadores del
 * contrato (FilterEditor) sobre estado local, con conteo en vivo. La descarga
 * va por chunks (max_limit del contrato) con progreso y cancelación; cada
 * request pasa por el RBAC del backend, sin permisos nuevos.
 */

const SAMPLE_LIMIT = 30;
const PDF_LIMIT = 1000;
const EXCEL_FILE_MAX = 100_000;
const HARD_CAP = 1_000_000;

const INPUT_CLASS =
  "w-full rounded-[9px] border border-[var(--border2)] bg-[var(--bg2)] px-2.5 py-1.5 text-[13px] text-[var(--tx)] outline-none transition focus:border-[var(--accent-bd)]";
const LABEL_CLASS = "mb-1 block text-[11.5px] font-medium text-[var(--tx3)]";
const SECTION_TITLE = "text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--tx3)]";

type Ready = {
  capability: ResourceCapability;
  list: ResourceListCapability;
  controls: FilterableControls;
  columns: ExportColumn[];
  enumLabels: ReadonlyMap<string, ReadonlyMap<string, string>>;
  maxLimit: number;
  urlQuery: ResourceListQuery;
};

type Sample = { total: number; rows: Record<string, unknown>[] };

function readHiddenColumns(resourceName: string): Set<string> {
  const entry = document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${hiddenColumnsCookieName(resourceName)}=`));
  if (!entry) return new Set();
  return new Set(decodeURIComponent(entry.slice(entry.indexOf("=") + 1)).split(","));
}

// Chips de los filtros locales del diálogo (label del contrato + value legible).
function localChips(
  fields: readonly FilterableFieldControl[],
  filters: Readonly<Record<string, string>>,
): { parameter: string; label: string; value: string }[] {
  const chips: { parameter: string; label: string; value: string }[] = [];
  for (const field of fields) {
    for (const operator of field.operators) {
      const names: [string | undefined, string][] = operator.fromParameter
        ? [
            [operator.fromParameter, `${field.label} · ${operator.label} (desde)`],
            [operator.toParameter, `${field.label} · ${operator.label} (hasta)`],
          ]
        : [[operator.parameterName, `${field.label} · ${operator.label}`]];
      for (const [parameter, label] of names) {
        if (!parameter || filters[parameter] === undefined) continue;
        const raw = filters[parameter];
        const option = operator.options?.find((entry) => entry.value === raw);
        chips.push({ parameter, label, value: option?.label ?? raw });
      }
    }
  }
  return chips;
}

export function ExportDialog({
  resourceName,
  defaultTitle,
  initialFormat = "excel",
  onClose,
}: Readonly<{
  resourceName: string;
  defaultTitle: string;
  // "pdf" cuando se abre desde el atajo de imprimir (Ctrl+P).
  initialFormat?: "excel" | "pdf";
  onClose: () => void;
}>) {
  const searchParams = useSearchParams();

  const [ready, setReady] = useState<Ready | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [format, setFormat] = useState<"excel" | "pdf">(initialFormat);
  const [title, setTitle] = useState(defaultTitle);
  const [scope, setScope] = useState<"filtered" | "page">("filtered");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [qText, setQText] = useState("");
  const [editingField, setEditingField] = useState<string | null>(null);
  const [pdfOrientation, setPdfOrientation] = useState<"portrait" | "landscape">("landscape");
  const [pdfPageSize, setPdfPageSize] = useState<PdfPageSize>("a4");
  const [pdfFontSize, setPdfFontSize] = useState(8);
  const [pdfTableStyle, setPdfTableStyle] = useState<"striped" | "grid" | "plain">("striped");
  const [headerText, setHeaderText] = useState("");
  const [footerText, setFooterText] = useState("");

  const [sample, setSample] = useState<Sample | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const pdfUrlRef = useRef<string | null>(null);

  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const cancelRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  // Carga de la capability + estado inicial desde la URL actual de la tabla.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const capability = await fetchResourceCapability(resourceName);
        if (cancelled) return;
        if (capability.view !== "table" || !capability.list) {
          setLoadError(true);
          return;
        }
        const list = capability.list;
        const controls = buildFilterableControls(list);
        const raw: Record<string, string> = {};
        searchParams.forEach((value, key) => {
          raw[key] = value;
        });
        const urlQuery = parseListQuery(raw, list, controls);
        const hidden = readHiddenColumns(resourceName);
        setReady({
          capability,
          list,
          controls,
          columns: exportColumns(list, hidden),
          enumLabels: enumLabelMaps(list),
          maxLimit: list.pagination.max_limit,
          urlQuery,
        });
        setFilters(urlQuery.filters);
        setQText(urlQuery.q ?? "");
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // searchParams se lee UNA vez al abrir: el diálogo trabaja sobre estado local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceName]);

  // q efectivo: respeta el mínimo del contrato (vacío = sin búsqueda).
  const effectiveQ = (() => {
    if (!ready || !ready.list.search.enabled) return undefined;
    const trimmed = qText.trim();
    const min = Math.max(ready.list.search.min_length ?? 0, 1);
    return trimmed.length >= min ? trimmed : undefined;
  })();

  // Conteo en vivo + filas de muestra para las vistas previas (debounce).
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const page = await fetchResourceListPage(
            ready.capability.api_path,
            {
              q: effectiveQ,
              sort: ready.urlQuery.sort,
              filters,
              limit: SAMPLE_LIMIT,
              offset: 0,
            },
            ready.controls,
          );
          if (cancelled) return;
          setSample({
            total: page.pagination.total,
            rows: page.items as Record<string, unknown>[],
          });
        } catch {
          if (!cancelled) setSample(null);
        }
      })();
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, filters, effectiveQ]);

  const filteredTotal = sample?.total ?? 0;
  const pageCount = ready
    ? Math.max(0, Math.min(ready.urlQuery.limit, filteredTotal - ready.urlQuery.offset))
    : 0;
  const exportTotal = scope === "page" ? pageCount : filteredTotal;
  const pdfDisabled = exportTotal > PDF_LIMIT;
  const effectiveFormat = pdfDisabled && format === "pdf" ? "excel" : format;

  // Celdas de muestra (mismo módulo que el archivo final).
  const sampleCells: ExportCell[][] = ready && sample
    ? buildExportRows(ready.columns, ready.enumLabels, sample.rows)
    : [];

  // Vista previa PDF: regenera con debounce y publica el bloburl en el iframe.
  useEffect(() => {
    if (!ready || effectiveFormat !== "pdf" || sample === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const url = await pdfPreviewUrl(
            {
              title,
              orientation: pdfOrientation,
              pageSize: pdfPageSize,
              fontSize: pdfFontSize,
              tableStyle: pdfTableStyle,
              headerText,
              footerText,
              generatedAt: new Date(),
              totalRows: exportTotal,
            },
            ready.columns,
            buildExportRows(ready.columns, ready.enumLabels, sample.rows.slice(0, SAMPLE_LIMIT)),
          );
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
          pdfUrlRef.current = url;
          setPdfUrl(url);
        } catch {
          if (!cancelled) setPdfUrl(null);
        }
      })();
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, effectiveFormat, sample, title, pdfOrientation, pdfPageSize, pdfFontSize, pdfTableStyle, headerText, footerText, exportTotal]);

  // Revocar el bloburl al desmontar.
  useEffect(() => {
    return () => {
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    };
  }, []);

  // Escape cierra (salvo durante una descarga).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !exporting) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, exporting]);

  const applyFilterUpdates = (updates: Record<string, string | null>) => {
    setFilters((previous) => {
      const next = { ...previous };
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value.trim() === "") delete next[key];
        else next[key] = value.trim();
      }
      return next;
    });
    setEditingField(null);
  };

  const removeFilter = (parameter: string) => {
    setFilters((previous) => {
      const next = { ...previous };
      delete next[parameter];
      return next;
    });
  };

  const runExport = async () => {
    if (!ready || exporting) return;
    setExportError(null);
    setDoneMessage(null);
    cancelRef.current = false;
    setExporting({ done: 0, total: exportTotal });

    try {
      let rows: Record<string, unknown>[];
      if (scope === "page") {
        const page = await fetchResourceListPage(
          ready.capability.api_path,
          { ...ready.urlQuery, q: ready.urlQuery.q, filters: ready.urlQuery.filters },
          ready.controls,
        );
        rows = page.items as Record<string, unknown>[];
      } else {
        const result = await fetchAllRows({
          apiPath: ready.capability.api_path,
          controls: ready.controls,
          baseQuery: { q: effectiveQ, sort: ready.urlQuery.sort, filters },
          batch: ready.maxLimit,
          cap: effectiveFormat === "pdf" ? PDF_LIMIT : HARD_CAP,
          onProgress: (done, total) => setExporting({ done, total }),
          shouldCancel: () => cancelRef.current,
        });
        if (result.cancelled) {
          setExporting(null);
          setDoneMessage("Exportación cancelada.");
          return;
        }
        rows = result.rows;
      }

      const cells = buildExportRows(ready.columns, ready.enumLabels, rows);
      const now = new Date();

      if (effectiveFormat === "pdf") {
        const config: PdfConfig = {
          title,
          orientation: pdfOrientation,
          pageSize: pdfPageSize,
          fontSize: pdfFontSize,
          tableStyle: pdfTableStyle,
          headerText,
          footerText,
          generatedAt: now,
          totalRows: rows.length,
        };
        downloadBlob(await pdfBlob(config, ready.columns, cells), exportFilename(title, "pdf", now));
      } else if (cells.length <= EXCEL_FILE_MAX) {
        downloadBlob(
          await buildWorkbookBlob({ title, headerText, footerText }, ready.columns, cells),
          exportFilename(title, "xlsx", now),
        );
      } else {
        // Multi-archivo por rebanadas contiguas: sin filas perdidas ni duplicadas.
        let part = 1;
        for (let start = 0; start < cells.length; start += EXCEL_FILE_MAX) {
          const slice = cells.slice(start, start + EXCEL_FILE_MAX);
          downloadBlob(
            await buildWorkbookBlob({ title, headerText, footerText }, ready.columns, slice),
            exportFilename(`${title}_parte-${part}`, "xlsx", now),
          );
          part += 1;
        }
      }

      setExporting(null);
      setDoneMessage(`Exportación completada (${rows.length} registros).`);
    } catch {
      setExporting(null);
      setExportError("No se pudo completar la exportación. Inténtalo nuevamente.");
    }
  };

  const fields = ready?.controls.ordered ?? [];
  const chips = localChips(fields, filters);
  const editing = editingField ? fields.find((field) => field.key === editingField) : undefined;
  const numeric = ready ? numericColumnIndexes(ready.columns) : new Set<number>();

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-[100] bg-[rgba(20,17,16,0.4)]"
        onPointerDown={() => {
          if (!exporting) onClose();
        }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Exportar ${defaultTitle}`}
        tabIndex={-1}
        className="fixed left-1/2 top-1/2 z-[101] flex max-h-[90vh] w-[min(1000px,95vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--elev)] shadow-[var(--shadow)] outline-none"
      >
        <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-[15px] font-semibold text-[var(--tx)]">Exportar · {defaultTitle}</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={Boolean(exporting)}
            aria-label="Cerrar"
            className="rounded-[8px] p-1.5 text-[var(--tx3)] transition hover:bg-[var(--panel2)] hover:text-[var(--tx)] disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        {loadError ? (
          <div className="p-6 text-sm text-[var(--tx2)]">No se pudo preparar la exportación.</div>
        ) : !ready ? (
          <div className="p-6 text-sm text-[var(--tx3)]">Cargando…</div>
        ) : (
          <div className="grid min-h-0 flex-1 md:grid-cols-[350px_1fr]">
            {/* Configuración */}
            <div className="min-h-0 space-y-4 overflow-y-auto p-4 md:border-r md:border-[var(--border)]">
              <section className="space-y-2">
                <p className={SECTION_TITLE}>Formato</p>
                <div className="flex gap-2">
                  {(
                    [
                      ["excel", "Excel"],
                      ["pdf", "PDF"],
                    ] as const
                  ).map(([value, label]) => (
                    <label
                      key={value}
                      className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-[10px] border px-3 py-2 text-[13px] font-medium transition ${
                        effectiveFormat === value
                          ? "border-[var(--accent-bd)] bg-[var(--accent-dim)] text-[var(--accent-tx)]"
                          : "border-[var(--border)] text-[var(--tx2)] hover:border-[var(--border2)]"
                      } ${value === "pdf" && pdfDisabled ? "cursor-not-allowed opacity-50" : ""}`}
                    >
                      <input
                        type="radio"
                        name="export-format"
                        value={value}
                        checked={effectiveFormat === value}
                        disabled={value === "pdf" && pdfDisabled}
                        onChange={() => setFormat(value)}
                        className="sr-only"
                      />
                      {label}
                    </label>
                  ))}
                </div>
                {pdfDisabled ? (
                  <p className="text-[11.5px] text-[var(--tx3)]">
                    PDF no disponible para más de {PDF_LIMIT} filas.
                  </p>
                ) : null}
              </section>

              <section>
                <label htmlFor="export-title" className={LABEL_CLASS}>
                  Título
                </label>
                <input
                  id="export-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className={INPUT_CLASS}
                />
              </section>

              <section className="space-y-2">
                <p className={SECTION_TITLE}>Elementos a exportar</p>
                {(
                  [
                    ["filtered", `Todos con filtros (${filteredTotal})`],
                    ["page", `Página actual (${pageCount})`],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-center gap-2 rounded-[10px] border border-[var(--border)] px-3 py-2 text-[13px] text-[var(--tx)]"
                  >
                    <input
                      type="radio"
                      name="export-scope"
                      value={value}
                      checked={scope === value}
                      onChange={() => setScope(value)}
                      className="accent-[var(--accent)]"
                    />
                    {label}
                  </label>
                ))}
              </section>

              {scope === "filtered" ? (
                <section className="space-y-2">
                  <p className={SECTION_TITLE}>Filtros del alcance</p>
                  {ready.list.search.enabled ? (
                    <input
                      type="search"
                      value={qText}
                      onChange={(event) => setQText(event.target.value)}
                      placeholder="Buscar…"
                      aria-label="Buscar"
                      className={INPUT_CLASS}
                    />
                  ) : null}
                  {chips.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {chips.map((chip) => (
                        <span
                          key={chip.parameter}
                          className="inline-flex max-w-full items-center gap-1 rounded-[9px] border border-[var(--accent-bd)] bg-[var(--accent-dim)] py-0.5 pl-2 pr-1 text-[12px] text-[var(--accent-tx)]"
                        >
                          <span className="truncate">
                            {chip.label}: {chip.value}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeFilter(chip.parameter)}
                            aria-label={`Quitar ${chip.label}`}
                            className="rounded-[6px] p-0.5 transition hover:bg-[var(--accent)] hover:text-[var(--on-accent)]"
                          >
                            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                              <path d="M18 6 6 18M6 6l12 12" />
                            </svg>
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {fields.length > 0 ? (
                    <select
                      value={editingField ?? ""}
                      onChange={(event) => setEditingField(event.target.value || null)}
                      aria-label="Añadir o editar filtro"
                      className={INPUT_CLASS}
                    >
                      <option value="">Añadir o editar filtro…</option>
                      {fields.map((field) => (
                        <option key={field.key} value={field.key}>
                          {field.label}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {editing ? (
                    <div className="rounded-[10px] border border-[var(--border)] p-3">
                      <FilterEditor
                        key={`${editing.key}-${fieldParameterNames(editing)
                          .map((name) => filters[name] ?? "")
                          .join("|")}`}
                        field={editing}
                        values={filters}
                        onApply={applyFilterUpdates}
                      />
                    </div>
                  ) : null}
                </section>
              ) : null}

              {effectiveFormat === "pdf" ? (
                <section className="space-y-2.5 rounded-[10px] border border-dashed border-[var(--border2)] p-3">
                  <p className={SECTION_TITLE}>Opciones de PDF</p>
                  <div>
                    <label htmlFor="pdf-pagesize" className={LABEL_CLASS}>
                      Tamaño de página
                    </label>
                    <select
                      id="pdf-pagesize"
                      value={pdfPageSize}
                      onChange={(event) => setPdfPageSize(event.target.value as PdfPageSize)}
                      className={INPUT_CLASS}
                    >
                      <option value="a4">A4 (210 × 297 mm)</option>
                      <option value="letter">Carta (216 × 279 mm)</option>
                      <option value="legal">Oficio (216 × 356 mm)</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="pdf-orientation" className={LABEL_CLASS}>
                      Orientación
                    </label>
                    <select
                      id="pdf-orientation"
                      value={pdfOrientation}
                      onChange={(event) => setPdfOrientation(event.target.value as "portrait" | "landscape")}
                      className={INPUT_CLASS}
                    >
                      <option value="landscape">Horizontal</option>
                      <option value="portrait">Vertical</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="pdf-fontsize" className={LABEL_CLASS}>
                      Tamaño de letra
                    </label>
                    <select
                      id="pdf-fontsize"
                      value={String(pdfFontSize)}
                      onChange={(event) => setPdfFontSize(Number(event.target.value))}
                      className={INPUT_CLASS}
                    >
                      <option value="6">6pt (muy pequeño)</option>
                      <option value="8">8pt (pequeño)</option>
                      <option value="10">10pt (normal)</option>
                      <option value="12">12pt (grande)</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="pdf-style" className={LABEL_CLASS}>
                      Estilo de tabla
                    </label>
                    <select
                      id="pdf-style"
                      value={pdfTableStyle}
                      onChange={(event) => setPdfTableStyle(event.target.value as "striped" | "grid" | "plain")}
                      className={INPUT_CLASS}
                    >
                      <option value="striped">Rayado</option>
                      <option value="grid">Con bordes</option>
                      <option value="plain">Simple</option>
                    </select>
                  </div>
                </section>
              ) : null}

              <section className="space-y-2.5">
                <p className={SECTION_TITLE}>Datos adicionales</p>
                <div>
                  <label htmlFor="export-header" className={LABEL_CLASS}>
                    Encabezado (institución, dirección…)
                  </label>
                  <textarea
                    id="export-header"
                    value={headerText}
                    onChange={(event) => setHeaderText(event.target.value)}
                    rows={2}
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor="export-footer" className={LABEL_CLASS}>
                    Pie (notas, aviso de confidencialidad…)
                  </label>
                  <textarea
                    id="export-footer"
                    value={footerText}
                    onChange={(event) => setFooterText(event.target.value)}
                    rows={2}
                    className={INPUT_CLASS}
                  />
                </div>
              </section>

              <section
                aria-live="polite"
                className="rounded-[10px] border border-[var(--border)] bg-[var(--panel2)] px-3 py-2 text-[12.5px] text-[var(--tx2)]"
              >
                Se exportarán <span className="font-semibold text-[var(--tx)]">{exportTotal}</span>{" "}
                registros en {effectiveFormat === "pdf" ? "PDF" : "Excel"}
                {effectiveFormat === "excel" && exportTotal > EXCEL_FILE_MAX
                  ? ` (${Math.ceil(exportTotal / EXCEL_FILE_MAX)} archivos)`
                  : ""}
                .
              </section>
            </div>

            {/* Vista previa en vivo */}
            <div className="flex min-h-[280px] flex-col bg-[var(--bg2)]">
              <div className="flex items-center justify-between px-4 pb-1 pt-3">
                <p className={SECTION_TITLE}>Vista previa</p>
                <p className="text-[11px] text-[var(--tx3)]">
                  Muestra con los primeros {Math.min(sampleCells.length, SAMPLE_LIMIT)} registros
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-4 pt-2">
                {effectiveFormat === "pdf" ? (
                  pdfUrl ? (
                    <iframe
                      title="Vista previa del PDF"
                      src={pdfUrl}
                      className="h-full min-h-[420px] w-full rounded-[10px] border border-[var(--border)] bg-white"
                    />
                  ) : (
                    <p className="text-[13px] text-[var(--tx3)]">Generando vista previa…</p>
                  )
                ) : (
                  <div className="overflow-auto rounded-[10px] border border-[var(--border)] bg-white shadow-[var(--soft)]">
                    <table className="min-w-full border-collapse text-[12px] text-[#2d2d2d]">
                      <tbody>
                        {headerText.trim() !== "" ? (
                          <tr>
                            <td
                              colSpan={ready.columns.length}
                              className="border border-[#e4e6ea] bg-[#f7f9fc] px-2 py-1.5 text-[11.5px] text-[#6e788c]"
                            >
                              {headerText}
                            </td>
                          </tr>
                        ) : null}
                        <tr>
                          {ready.columns.map((column) => (
                            <th
                              key={column.name}
                              className="border border-[#d0d4da] bg-[#212121] px-2 py-1.5 text-left font-semibold text-white"
                            >
                              {column.label}
                            </th>
                          ))}
                        </tr>
                        {sampleCells.map((row, rowIndex) => (
                          <tr key={rowIndex} className={rowIndex % 2 === 1 ? "bg-[#f3f6fa]" : ""}>
                            {row.map((cell, cellIndex) => (
                              <td
                                key={cellIndex}
                                className={`border border-[#e4e6ea] px-2 py-1 whitespace-nowrap ${
                                  numeric.has(cellIndex) ? "text-right tabular-nums" : ""
                                }`}
                              >
                                {cell.text}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {footerText.trim() !== "" ? (
                          <tr>
                            <td
                              colSpan={ready.columns.length}
                              className="border border-[#e4e6ea] px-2 py-1.5 text-[11.5px] text-[#6e788c]"
                            >
                              {footerText}
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3">
          <div aria-live="polite" className="min-w-0 flex-1 text-[12.5px]">
            {exporting ? (
              <span className="text-[var(--tx2)]">
                Descargando {exporting.done} de {exporting.total}…
                <span className="ml-2 inline-block h-1.5 w-32 overflow-hidden rounded-full bg-[var(--panel2)] align-middle">
                  <span
                    className="block h-full rounded-full bg-[var(--accent)] transition-[width]"
                    style={{
                      width: `${exporting.total > 0 ? Math.min(100, Math.round((exporting.done / exporting.total) * 100)) : 0}%`,
                    }}
                  />
                </span>
              </span>
            ) : exportError ? (
              <span className="text-[var(--danger)]">{exportError}</span>
            ) : doneMessage ? (
              <span className="text-[var(--ok)]">{doneMessage}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {exporting ? (
              <button
                type="button"
                onClick={() => {
                  cancelRef.current = true;
                }}
                className="rounded-[10px] border border-[var(--border)] px-3 py-1.5 text-[13px] font-medium text-[var(--tx2)] transition hover:text-[var(--danger)]"
              >
                Cancelar descarga
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-[10px] border border-[var(--border)] px-3 py-1.5 text-[13px] font-medium text-[var(--tx2)] transition hover:bg-[var(--panel2)]"
                >
                  Cerrar
                </button>
                <button
                  type="button"
                  onClick={() => void runExport()}
                  disabled={!ready || exportTotal === 0}
                  className="rounded-[10px] bg-[var(--accent)] px-4 py-1.5 text-[13px] font-semibold text-[var(--on-accent)] shadow-[var(--soft)] transition hover:brightness-105 disabled:opacity-50"
                >
                  Exportar
                </button>
              </>
            )}
          </div>
        </footer>
      </div>
    </>
  );
}
