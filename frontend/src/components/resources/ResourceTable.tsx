import type { ReactNode } from "react";
import Link from "next/link";

import type {
  FieldValueType,
  ItemReference,
  ResourceActionCapability,
  ResourceListCapability,
  ResourceRelatedListCapability,
  ResourceRelationCapability,
} from "@/core/api/contracts";
import type { ResourceListPage } from "@/core/resources/list-types";
import type { ResourceListQuery } from "@/core/resources/list-query";
import type { FilterableFieldControl } from "@/core/resources/filterable";
import { visibleActionsForRow } from "@/core/resources/resource-action";

import { CellView } from "./CellView";
import { ColumnFilterButton } from "./ColumnFilterButton";
import { enumLabelMaps } from "./export/build-export-rows";
import { ResourceRowActions } from "./ResourceRowActions";
import { ResourceTableViewport } from "./ResourceTableViewport";
import { RowActionsFlyout } from "./RowActionsFlyout";

// Chips de acción dentro del flyout (Ver/Editar/relaciones): compactos, sin subrayado.
const ACTION_LINK_CLASS =
  "rounded-full px-2.5 py-1 text-[12.5px] font-medium whitespace-nowrap text-[var(--accent-tx)] transition hover:bg-[var(--accent-dim)]";

function rowId(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  return typeof value === "string" && value !== "" ? value : null;
}

// Prioridad HEURÍSTICA por columna (guía de presentación, no contrato): la
// primera columna y los enums de estado son alta; datetimes de auditoría y
// uuids son baja → se ocultan primero cuando el contenedor se estrecha.
function columnPriorityClass(index: number, type: FieldValueType): string {
  if (index === 0) return "";
  if (type === "datetime" || type === "uuid") return "rt-prio-low";
  return "";
}

// Alineación por tipo de dato (encabezado y celda): números a la derecha con
// tabular-nums, booleanos centrados; el resto a la izquierda.
function columnAlignment(type: FieldValueType): {
  th: string;
  cell: string;
  justify: string;
} {
  switch (type) {
    case "integer":
    case "decimal":
      return { th: "text-right", cell: "text-right tabular-nums", justify: "justify-end" };
    case "boolean":
      return { th: "text-center", cell: "text-center", justify: "justify-center" };
    default:
      return { th: "text-left", cell: "", justify: "" };
  }
}

function SortChevron({ direction }: Readonly<{ direction: "asc" | "desc" }>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-[var(--accent-tx)]"
    >
      {direction === "asc" ? <path d="m18 15-6-6-6 6" /> : <path d="m6 9 6 6 6-6" />}
    </svg>
  );
}

function SortableHeader({
  label,
  href,
  direction,
  justify,
  padClass,
}: Readonly<{
  label: string;
  href: string;
  direction: "asc" | "desc" | null;
  justify: string;
  padClass: string;
}>) {
  const described =
    direction === "asc" ? "ascendente" : direction === "desc" ? "descendente" : "sin orden";

  // Toda la celda es el área clickeable; el chevrón sólo aparece en la columna
  // activa (el cursor + hover señalan que es ordenable).
  return (
    <Link
      href={href}
      aria-label={`Ordenar por ${label} (actual: ${described})`}
      className={`flex min-w-0 flex-1 cursor-pointer select-none items-center gap-2 transition hover:bg-[var(--panel2)] hover:text-[var(--tx)] ${padClass} ${justify}`}
    >
      <span className="truncate">{label}</span>
      {direction ? <SortChevron direction={direction} /> : null}
    </Link>
  );
}

// Estado vacío: bloque único SIN headers ni tabla (no roba espacio) con el CTA
// que corresponda: limpiar filtros si la falta de resultados viene de un filtro,
// crear el primero cuando el recurso está realmente vacío y se puede crear.
function EmptyState({
  compact,
  hasActiveFilters,
  clearFiltersHref,
  createHref,
  onCreateInline,
}: Readonly<{
  compact: boolean;
  hasActiveFilters: boolean;
  clearFiltersHref?: string;
  createHref?: string;
  onCreateInline?: () => void;
}>) {
  const ctaClass = "font-medium text-[var(--accent-tx)] underline-offset-2 hover:underline";
  let body: ReactNode;
  if (hasActiveFilters && clearFiltersHref) {
    body = (
      <>
        Sin resultados para estos filtros.{" "}
        <Link href={clearFiltersHref} className={ctaClass}>
          Limpiar filtros
        </Link>
      </>
    );
  } else if (createHref) {
    body = (
      <>
        No hay registros.{" "}
        <Link href={createHref} className={ctaClass}>
          Crear el primero
        </Link>
      </>
    );
  } else if (onCreateInline) {
    body = (
      <>
        No hay registros.{" "}
        <button type="button" onClick={onCreateInline} className={ctaClass}>
          Crear el primero
        </button>
      </>
    );
  } else {
    body = <>No hay registros.</>;
  }

  return (
    <div
      className={
        compact
          ? "rounded-[10px] border border-dashed border-[var(--border2)] px-3 py-4 text-center text-[13px] text-[var(--tx3)]"
          : "rounded-[14px] border border-dashed border-[var(--border2)] px-4 py-8 text-center text-sm text-[var(--tx3)]"
      }
    >
      {body}
    </div>
  );
}

export function ResourceTable({
  label,
  list,
  page,
  explicitSort,
  buildSortHref,
  resourceName,
  relations = [],
  actions = [],
  relatedLists = [],
  itemReference = null,
  editEnabled = false,
  detailEnabled = false,
  compact = false,
  hasActiveFilters = false,
  clearFiltersHref,
  createHref,
  onCreateInline,
  maxHeightClassName,
  hiddenColumns = [],
  headerFilters,
  onEditInline,
  renderRowLead,
}: Readonly<{
  label: string;
  list: ResourceListCapability;
  page: ResourceListPage;
  explicitSort: ResourceListQuery["sort"];
  buildSortHref: (fieldName: string) => string;
  resourceName: string;
  relations?: ResourceRelationCapability[];
  actions?: ResourceActionCapability[];
  // Listas relacionadas del contrato (capability.related_lists): enlace por fila a la
  // lista del recurso destino filtrada por esta fila (p. ej. signos vitales de la
  // consulta). El backend ya las filtró por permiso de lectura del destino.
  relatedLists?: ResourceRelatedListCapability[];
  itemReference?: ItemReference | null;
  editEnabled?: boolean;
  detailEnabled?: boolean;
  // Modo embebido (record panel del chat): densidad reducida y chrome mínimo,
  // el card que envuelve pone el marco — aquí no se duplica.
  compact?: boolean;
  // Estado vacío: qué CTA mostrar. hasActiveFilters refleja filtros/búsqueda del
  // USUARIO (no el scope fijo del contexto, p. ej. patient_id del record panel).
  hasActiveFilters?: boolean;
  clearFiltersHref?: string;
  createHref?: string;
  onCreateInline?: () => void;
  // p. ej. "max-h-[70vh]": activa el scroll vertical interno + header sticky.
  maxHeightClassName?: string;
  // Columnas ocultas por el usuario (cookie por recurso, leída en el server).
  hiddenColumns?: readonly string[];
  // Menú de filtro estilo Excel por columna: campos filtrables por nombre de
  // columna + estado canónico para reconstruir URLs. Opt-in (sólo /resources).
  headerFilters?: {
    basePath: string;
    params: Record<string, string>;
    fields: Record<string, FilterableFieldControl>;
  };
  // Opt-in: si se pasa, "Editar" abre el formulario INLINE (callback con id+fila) en vez de navegar
  // a /resources/.../edit. Las páginas /resources NO lo pasan → conservan la navegación de siempre.
  onEditInline?: (id: string, row: Record<string, unknown>) => void;
  // Acción ESPECIAL por fila, SIEMPRE VISIBLE junto a la pestaña de acciones (p. ej. el botón de
  // chat del paciente). Opt-in: sólo lo pasa la tabla de pacientes.
  renderRowLead?: (id: string, row: Record<string, unknown>) => ReactNode;
}>) {
  const hiddenSet = new Set(hiddenColumns);
  const columns = list.fields.filter(
    (field) => field.visible_in_list && !hiddenSet.has(field.name),
  );
  const { items } = page;
  const idField = itemReference?.field ?? "id";
  const actionPlaceholder = itemReference?.placeholder ?? "id";
  const hasActions =
    detailEnabled ||
    editEnabled ||
    relations.length > 0 ||
    actions.length > 0 ||
    relatedLists.length > 0 ||
    Boolean(renderRowLead);
  const enumLabels = enumLabelMaps(list);
  // Título de la tarjeta en modo container-angosto: la primera columna de texto
  // (un expediente numérico como título lee mal); cae a la primera si no hay.
  const cardTitleName = (columns.find((column) => column.type === "string") ?? columns[0])?.name;

  // Densidad: el modo compacto recorta paddings y alto del header.
  const cellPad = compact ? "px-3 py-2" : "px-4 py-3";
  const headPad = compact ? "h-9 px-3" : "h-10 px-4";
  // rt-container/rt-cards: container queries — prioridad de columnas y modo
  // tarjetas según el ancho del CONTENEDOR (página completa vs record panel).
  const containerClass = compact
    ? "rt-container rt-cards overflow-hidden rounded-[10px] border border-[var(--border)]"
    : "rt-container rt-cards overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--panel)] shadow-[var(--soft)]";

  function itemHref(id: string, ...segments: string[]): string {
    const tail = segments.map((segment) => encodeURIComponent(segment)).join("/");
    return `/resources/${encodeURIComponent(resourceName)}/${encodeURIComponent(id)}/${tail}`;
  }

  return (
    <section className={compact ? "space-y-2" : "space-y-4"}>
      {label ? (
        <header>
          <h2 className="text-xl font-semibold text-[var(--tx)]">{label}</h2>
        </header>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          compact={compact}
          hasActiveFilters={hasActiveFilters}
          clearFiltersHref={clearFiltersHref}
          createHref={createHref}
          onCreateInline={onCreateInline}
        />
      ) : (
        <div className={containerClass}>
          <ResourceTableViewport scrollerClassName={maxHeightClassName}>
            <table className="min-w-full divide-y divide-[var(--border)] text-sm">
              <thead className="rt-thead">
                <tr>
                  {columns.map((column, columnIndex) => {
                    const active =
                      explicitSort && explicitSort.field === column.name
                        ? explicitSort.direction
                        : null;
                    const align = columnAlignment(column.type);
                    const filterField = headerFilters?.fields[column.name];
                    return (
                      <th
                        key={column.name}
                        scope="col"
                        aria-sort={
                          active === "asc"
                            ? "ascending"
                            : active === "desc"
                              ? "descending"
                              : undefined
                        }
                        className={`rt-th-resize group/th whitespace-nowrap p-0 align-middle text-[13px] font-medium text-[var(--tx2)] ${align.th} ${columnPriorityClass(columnIndex, column.type)}`}
                      >
                        <div className={`flex items-center ${align.justify}`}>
                          {column.sortable ? (
                            <SortableHeader
                              label={column.label}
                              href={buildSortHref(column.name)}
                              direction={active}
                              justify={align.justify}
                              padClass={headPad}
                            />
                          ) : (
                            <span className={`flex min-w-0 flex-1 items-center ${headPad}`}>
                              {column.label}
                            </span>
                          )}
                          {filterField && headerFilters ? (
                            <span className="pr-1.5">
                              <ColumnFilterButton
                                field={filterField}
                                basePath={headerFilters.basePath}
                                params={headerFilters.params}
                              />
                            </span>
                          ) : null}
                        </div>
                      </th>
                    );
                  })}
                  {hasActions ? (
                    <th scope="col" className={`rt-actions-head ${compact ? "h-9 px-2" : "h-10 px-3"}`}>
                      <span className="sr-only">Acciones</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {items.map((row, rowIndex) => {
                  const id = rowId(row, idField);
                  // visible_when se evalúa client-side por fila: las acciones cuya
                  // condición de estado no se cumple no se proyectan (guía de UI; el
                  // backend revalida). enabled_when lo resuelve ResourceRowActions.
                  const rowActions = visibleActionsForRow(actions, row);
                  const hasFlyout =
                    Boolean(id) &&
                    (detailEnabled ||
                      editEnabled ||
                      relations.length > 0 ||
                      relatedLists.length > 0 ||
                      rowActions.length > 0);
                  return (
                    <tr key={id ?? rowIndex} className="rt-row">
                      {columns.map((column, columnIndex) => {
                        const align = columnAlignment(column.type);
                        const spanClass = `block max-w-[36ch] truncate ${align.cell}`;
                        return (
                          <td
                            key={column.name}
                            data-label={column.label}
                            className={`${cellPad} text-[var(--tx)] ${columnPriorityClass(columnIndex, column.type)} ${
                              column.name === cardTitleName ? "rt-card-title" : ""
                            }`}
                          >
                            <CellView
                              value={row[column.name]}
                              type={column.type}
                              enumLabels={enumLabels.get(column.name)}
                              className={spanClass}
                            />
                          </td>
                        );
                      })}
                      {hasActions ? (
                        <td className={`rt-actions-cell ${compact ? "px-2 py-1.5" : "px-3 py-2"}`}>
                          <div className="flex items-center justify-end gap-1.5">
                            {id && !hasFlyout && renderRowLead ? renderRowLead(id, row) : null}
                            {id && hasFlyout ? (
                              <RowActionsFlyout lead={renderRowLead ? renderRowLead(id, row) : undefined}>
                                {detailEnabled ? (
                                  <Link
                                    href={`/resources/${encodeURIComponent(resourceName)}/${encodeURIComponent(id)}`}
                                    data-row-detail
                                    className={ACTION_LINK_CLASS}
                                  >
                                    Ver
                                  </Link>
                                ) : null}
                                {editEnabled ? (
                                  onEditInline ? (
                                    <button
                                      type="button"
                                      onClick={() => onEditInline(id, row)}
                                      className={ACTION_LINK_CLASS}
                                    >
                                      Editar
                                    </button>
                                  ) : (
                                    <Link href={itemHref(id, "edit")} className={ACTION_LINK_CLASS}>
                                      Editar
                                    </Link>
                                  )
                                ) : null}
                                {relations.map((relation) => (
                                  <Link
                                    key={relation.name}
                                    href={itemHref(id, relation.name)}
                                    className={ACTION_LINK_CLASS}
                                  >
                                    {relation.label}
                                  </Link>
                                ))}
                                {relatedLists.map((related) => (
                                  <Link
                                    key={related.resource}
                                    href={`/resources/${encodeURIComponent(related.resource)}?${encodeURIComponent(related.parameter_name)}=${encodeURIComponent(id)}`}
                                    className={ACTION_LINK_CLASS}
                                  >
                                    {related.label}
                                  </Link>
                                ))}
                                {rowActions.length > 0 ? (
                                  <ResourceRowActions
                                    placeholder={actionPlaceholder}
                                    id={id}
                                    actions={rowActions}
                                    item={row}
                                  />
                                ) : null}
                              </RowActionsFlyout>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ResourceTableViewport>
        </div>
      )}
    </section>
  );
}
