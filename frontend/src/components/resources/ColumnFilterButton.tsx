"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { FilterableFieldControl } from "@/core/resources/filterable";

import { FilterEditor } from "./FilterEditor";
import { FilterPanel, measureAnchor, type AnchorRect } from "./FilterPanel";
import { fieldParameterNames, hrefWithParamUpdates } from "./filter-nav";

/**
 * Embudo de filtro en el encabezado de una columna (menú estilo Excel). El
 * panel vive en un portal — no lo limita el alto de la tabla — y en pantallas
 * angostas se vuelve diálogo. La columna con filtro activo muestra el embudo
 * SIEMPRE (relleno + punto acento); las demás lo revelan al hover/focus.
 */
export function ColumnFilterButton({
  field,
  basePath,
  params,
}: Readonly<{
  field: FilterableFieldControl;
  basePath: string;
  params: Readonly<Record<string, string>>;
}>) {
  const router = useRouter();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);

  const active = fieldParameterNames(field).some((name) => (params[name] ?? "") !== "");

  const toggle = () => {
    const button = buttonRef.current;
    if (!button) return;
    setAnchor((current) => (current ? null : measureAnchor(button)));
  };

  const apply = (updates: Record<string, string | null>) => {
    setAnchor(null);
    router.push(hrefWithParamUpdates(basePath, params, updates), { scroll: false });
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={Boolean(anchor)}
        aria-label={`Filtrar por ${field.label}`}
        title={`Filtrar por ${field.label}`}
        className={`rt-col-filter relative shrink-0 rounded-[7px] p-1 transition hover:bg-[var(--accent-dim)] hover:text-[var(--accent-tx)] hover:opacity-100 focus-visible:opacity-100 ${
          active ? "text-[var(--accent-tx)]" : "text-[var(--tx3)] opacity-0 group-hover/th:opacity-100"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          width="12"
          height="12"
          fill={active ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
        </svg>
        {active ? (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-[var(--accent)]"
          />
        ) : null}
      </button>
      {anchor ? (
        <FilterPanel
          anchor={anchor}
          title={`Filtrar · ${field.label}`}
          onClose={() => setAnchor(null)}
          ignoreRef={buttonRef}
        >
          <FilterEditor field={field} values={params} onApply={apply} />
        </FilterPanel>
      ) : null}
    </>
  );
}
