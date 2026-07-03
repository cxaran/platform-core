"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { FilterableFieldControl } from "@/core/resources/filterable";

import { FilterEditor } from "./FilterEditor";
import { FilterPanel, measureAnchor, type AnchorRect } from "./FilterPanel";
import { hrefWithParamUpdates } from "./filter-nav";

/**
 * "+ Filtro" de la barra: popover con la lista de campos filtrables del
 * contrato; al elegir uno se muestran sus operadores (FilterEditor). Aplicar
 * navega con router.push — la URL sigue siendo el único estado.
 */
export function AddFilterPopover({
  fields,
  basePath,
  params,
}: Readonly<{
  fields: readonly FilterableFieldControl[];
  basePath: string;
  params: Readonly<Record<string, string>>;
}>) {
  const router = useRouter();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [fieldKey, setFieldKey] = useState<string | null>(null);

  if (fields.length === 0) return null;

  const selected = fieldKey ? fields.find((field) => field.key === fieldKey) : undefined;

  const toggle = () => {
    const button = buttonRef.current;
    if (!button) return;
    setFieldKey(null);
    setAnchor((current) => (current ? null : measureAnchor(button)));
  };

  const close = () => {
    setAnchor(null);
    setFieldKey(null);
  };

  const apply = (updates: Record<string, string | null>) => {
    close();
    router.push(hrefWithParamUpdates(basePath, params, updates), { scroll: false });
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={Boolean(anchor)}
        data-hotkey="add-filter"
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border border-dashed border-[var(--border2)] px-3 text-[12.5px] font-medium text-[var(--tx2)] transition hover:border-[var(--accent-bd)] hover:text-[var(--accent-tx)]"
      >
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Filtro
      </button>
      {anchor ? (
        <FilterPanel
          anchor={anchor}
          title={selected ? `Filtrar · ${selected.label}` : "Añadir filtro"}
          onClose={close}
          ignoreRef={buttonRef}
        >
          {selected ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setFieldKey(null)}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--tx3)] transition hover:text-[var(--accent-tx)]"
              >
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m15 18-6-6 6-6" />
                </svg>
                Campos
              </button>
              <FilterEditor field={selected} values={params} onApply={apply} />
            </div>
          ) : (
            <ul className="space-y-0.5">
              {fields.map((field) => (
                <li key={field.key}>
                  <button
                    type="button"
                    onClick={() => setFieldKey(field.key)}
                    className="flex w-full items-center justify-between rounded-[8px] px-2 py-1.5 text-left text-[13px] text-[var(--tx)] transition hover:bg-[var(--panel2)]"
                  >
                    <span>{field.label}</span>
                    <span className="text-[11px] text-[var(--tx3)]">{field.valueType}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </FilterPanel>
      ) : null}
    </>
  );
}
