import Link from "next/link";

import type { ResourceListPage } from "@/core/resources/list-types";

const LINK_CLASS =
  "rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50";
const DISABLED_CLASS =
  "rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-300";

export function ResourcePagination({
  prevHref,
  nextHref,
  pagination,
}: Readonly<{
  prevHref?: string;
  nextHref?: string;
  pagination: ResourceListPage["pagination"];
}>) {
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-sm text-slate-500">Total: {pagination.total} registros</p>
      <div className="flex items-center gap-2">
        {prevHref ? (
          <Link href={prevHref} className={LINK_CLASS} rel="prev">
            Anterior
          </Link>
        ) : (
          <span className={DISABLED_CLASS} aria-disabled="true">
            Anterior
          </span>
        )}
        {nextHref ? (
          <Link href={nextHref} className={LINK_CLASS} rel="next">
            Siguiente
          </Link>
        ) : (
          <span className={DISABLED_CLASS} aria-disabled="true">
            Siguiente
          </span>
        )}
      </div>
    </div>
  );
}
