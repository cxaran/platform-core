import Link from "next/link";

import type { ResourceListCapability } from "@/core/api/contracts";
import type { ResourceListPage } from "@/core/resources/list-types";
import type { ResourceListQuery } from "@/core/resources/list-query";

import { formatCell } from "./format-cell";

function SortableHeader({
  label,
  href,
  direction,
}: Readonly<{
  label: string;
  href: string;
  direction: "asc" | "desc" | null;
}>) {
  const indicator = direction === "asc" ? "↑" : direction === "desc" ? "↓" : "↕";
  const described =
    direction === "asc" ? "ascendente" : direction === "desc" ? "descendente" : "sin orden";

  return (
    <Link
      href={href}
      aria-label={`Ordenar por ${label} (actual: ${described})`}
      className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900"
    >
      <span>{label}</span>
      <span aria-hidden="true" className="text-xs text-slate-400">
        {indicator}
      </span>
    </Link>
  );
}

export function ResourceTable({
  label,
  list,
  page,
  explicitSort,
  buildSortHref,
}: Readonly<{
  label: string;
  list: ResourceListCapability;
  page: ResourceListPage;
  explicitSort: ResourceListQuery["sort"];
  buildSortHref: (fieldName: string) => string;
}>) {
  const columns = list.fields.filter((field) => field.visible_in_list);
  const { items } = page;

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-xl font-semibold text-slate-900">{label}</h2>
      </header>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((column) => {
                const active =
                  explicitSort && explicitSort.field === column.name
                    ? explicitSort.direction
                    : null;
                return (
                  <th
                    key={column.name}
                    scope="col"
                    className="px-4 py-3 text-left font-medium text-slate-600"
                  >
                    {column.sortable ? (
                      <SortableHeader
                        label={column.label}
                        href={buildSortHref(column.name)}
                        direction={active}
                      />
                    ) : (
                      column.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length || 1}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No hay registros.
                </td>
              </tr>
            ) : (
              items.map((row, rowIndex) => (
                <tr key={rowIndex} className="hover:bg-slate-50">
                  {columns.map((column) => (
                    <td key={column.name} className="px-4 py-3 text-slate-800">
                      {formatCell(row[column.name], column.type)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
