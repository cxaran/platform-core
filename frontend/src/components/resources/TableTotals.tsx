import type { ResourceStatsResponse } from "@/core/api/contracts";

/**
 * Pie de totales de la tabla (estilo barra de estado de una hoja de cálculo):
 * conteo bajo el filtro activo + suma/promedio/mín/máx por columna numérica
 * agregable. Server component puro: los números ya vienen del backend.
 */

const NUMBER_FORMAT = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 });

function formatStat(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return NUMBER_FORMAT.format(value);
}

export function TableTotals({
  stats,
  columns,
}: Readonly<{
  stats: ResourceStatsResponse;
  columns: readonly { name: string; label: string }[];
}>) {
  const entries = columns
    .map((column) => ({ column, aggregates: stats.fields[column.name] }))
    .filter((entry) => entry.aggregates !== undefined);

  return (
    <div
      role="status"
      aria-label="Totales bajo el filtro activo"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[12.5px] text-[var(--tx2)] shadow-[var(--soft)]"
    >
      <span>
        <span className="font-semibold text-[var(--tx)] tabular-nums">
          {NUMBER_FORMAT.format(stats.count)}
        </span>{" "}
        fila(s) con el filtro activo
      </span>
      {entries.map(({ column, aggregates }) => (
        <span key={column.name} className="inline-flex items-center gap-1.5 tabular-nums">
          <span className="font-medium text-[var(--tx)]">{column.label}:</span>
          <span title="Suma">Σ {formatStat(aggregates?.sum)}</span>
          <span title="Promedio">x̄ {formatStat(aggregates?.avg)}</span>
          <span title="Mínimo y máximo" className="text-[var(--tx3)]">
            [{formatStat(aggregates?.min)} – {formatStat(aggregates?.max)}]
          </span>
        </span>
      ))}
    </div>
  );
}
