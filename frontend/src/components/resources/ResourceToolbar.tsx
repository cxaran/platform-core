import type { ReactNode } from "react";
import Link from "next/link";

import type { FilterableFieldControl } from "@/core/resources/filterable";

import { AddFilterPopover } from "./AddFilterPopover";
import { ColumnVisibilityMenu } from "./ColumnVisibilityMenu";
import { ResourceSearch } from "./ResourceSearch";
import { TableHotkeys } from "./TableHotkeys";
import { ViewsMenu } from "./ViewsMenu";
import { ExportButton } from "./export/ExportButton";
import { hrefWithParamUpdates } from "./filter-nav";

/**
 * Barra de la lista (composición del patrón de DynamicTable): título, búsqueda,
 * chips de filtros activos, "+ Filtro", visibilidad de columnas y acciones — en
 * UN renglón que envuelve responsivamente cuando no cabe. Los chips son Links
 * puros (quitar un filtro = URL sin ese parámetro); las islas de cliente sólo
 * aportan el popover, el debounce y la cookie de columnas.
 */

type ActiveChip = {
  parameter: string;
  label: string;
  value: string;
};

// Un chip por parámetro activo, con el label del contrato y el value legible
// (label de la opción para selects; sufijo desde/hasta en rangos).
function activeChips(
  fields: readonly FilterableFieldControl[],
  filters: Readonly<Record<string, string>>,
): ActiveChip[] {
  const chips: ActiveChip[] = [];
  for (const field of fields) {
    for (const operator of field.operators) {
      if (operator.widget === "daterange") {
        for (const [parameter, suffix] of [
          [operator.fromParameter, "desde"],
          [operator.toParameter, "hasta"],
        ] as const) {
          if (parameter && filters[parameter] !== undefined) {
            chips.push({
              parameter,
              label: `${field.label} · ${operator.label} (${suffix})`,
              value: filters[parameter],
            });
          }
        }
        continue;
      }
      const parameter = operator.parameterName;
      if (!parameter || filters[parameter] === undefined) continue;
      const raw = filters[parameter];
      const option = operator.options?.find((entry) => entry.value === raw);
      chips.push({
        parameter,
        label: `${field.label} · ${operator.label}`,
        value: option?.label ?? raw,
      });
    }
  }
  return chips;
}

export function ResourceToolbar({
  label,
  resourceName,
  basePath,
  params,
  fields,
  filters,
  search,
  columns,
  hiddenColumns,
  actions,
}: Readonly<{
  label: string;
  resourceName: string;
  basePath: string;
  // Estado canónico actual (buildListSearchParams) como record serializable.
  params: Readonly<Record<string, string>>;
  fields: readonly FilterableFieldControl[];
  filters: Readonly<Record<string, string>>;
  search: { enabled: boolean; value: string; minLength: number; maxLength?: number };
  columns: readonly { name: string; label: string }[];
  hiddenColumns: readonly string[];
  // Acciones del recurso (p. ej. link "Nuevo"), al final del renglón.
  actions?: ReactNode;
}>) {
  const chips = activeChips(fields, filters);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Atajos de teclado (sin UI): /, f, j/k, ←/→, Enter, Ctrl+P. */}
      <TableHotkeys />
      <h2 className="mr-1 shrink-0 text-lg font-semibold text-[var(--tx)]">{label}</h2>

      {search.enabled ? (
        <ResourceSearch
          basePath={basePath}
          params={params}
          value={search.value}
          minLength={search.minLength}
          maxLength={search.maxLength}
        />
      ) : null}

      {chips.map((chip) => (
        <span
          key={chip.parameter}
          className="inline-flex h-9 max-w-[260px] items-center gap-1 rounded-[10px] border border-[var(--accent-bd)] bg-[var(--accent-dim)] pl-2.5 pr-1 text-[12.5px] text-[var(--accent-tx)]"
        >
          <span className="truncate">
            <span className="font-medium">{chip.label}:</span> {chip.value}
          </span>
          <Link
            href={hrefWithParamUpdates(basePath, params, { [chip.parameter]: null })}
            aria-label={`Quitar filtro ${chip.label}`}
            title="Quitar filtro"
            className="rounded-[7px] p-1 transition hover:bg-[var(--accent)] hover:text-[var(--on-accent)]"
          >
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </Link>
        </span>
      ))}

      <AddFilterPopover fields={fields} basePath={basePath} params={params} />

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <ViewsMenu resourceName={resourceName} basePath={basePath} params={params} />
        <ExportButton resourceName={resourceName} defaultTitle={label} />
        <ColumnVisibilityMenu
          resourceName={resourceName}
          columns={columns}
          hidden={hiddenColumns}
        />
        {actions}
      </div>
    </div>
  );
}
