import type { ResourceListCapability } from "@/core/api/contracts";

type SearchCapability = ResourceListCapability["search"];

export function ResourceSearchForm({
  action,
  search,
  value,
  tooShort,
  sortParam,
  limit,
}: Readonly<{
  action: string;
  search: SearchCapability;
  value: string;
  tooShort: boolean;
  sortParam?: string;
  limit: number;
}>) {
  if (!search.enabled) {
    return null;
  }

  const effectiveMin = Math.max(search.min_length ?? 0, 1);

  return (
    <form method="get" action={action} className="flex flex-wrap items-start gap-2">
      <div className="flex flex-col">
        <div className="flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={value}
            minLength={search.min_length ?? undefined}
            maxLength={search.max_length ?? undefined}
            placeholder="Buscar…"
            aria-label="Buscar"
            className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          {/* Preserva el sort explícito y el límite; sin offset → la búsqueda inicia en 0. */}
          {sortParam ? <input type="hidden" name="sort" value={sortParam} /> : null}
          <input type="hidden" name="limit" value={limit} />
          <button
            type="submit"
            className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            Buscar
          </button>
        </div>
        {tooShort ? (
          <p className="mt-1 text-xs text-slate-500">
            Escribe al menos {effectiveMin} caracteres para buscar.
          </p>
        ) : null}
      </div>
    </form>
  );
}
