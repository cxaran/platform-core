"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { FilterPanel, measureAnchor, type AnchorRect } from "./FilterPanel";
import { hiddenColumnsCookieName } from "./filter-nav";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Fuera del componente: React Compiler no permite mutar document.* en su cuerpo.
function persistHiddenColumns(resourceName: string, hidden: ReadonlySet<string>): void {
  const value = encodeURIComponent([...hidden].join(","));
  document.cookie = `${hiddenColumnsCookieName(resourceName)}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}

/**
 * Visibilidad de columnas con persistencia POR RECURSO en cookie (no
 * localStorage) para que el server la lea y renderice sin parpadeo. La cookie
 * guarda las columnas OCULTAS; al alternar se reescribe y router.refresh()
 * re-renderiza la tabla en el server con el nuevo estado.
 */
export function ColumnVisibilityMenu({
  resourceName,
  columns,
  hidden,
}: Readonly<{
  resourceName: string;
  columns: readonly { name: string; label: string }[];
  hidden: readonly string[];
}>) {
  const router = useRouter();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);

  if (columns.length <= 1) return null;

  const hiddenSet = new Set(hidden);
  const visibleCount = columns.filter((column) => !hiddenSet.has(column.name)).length;

  const toggleColumn = (name: string) => {
    const next = new Set(hiddenSet);
    if (next.has(name)) {
      next.delete(name);
    } else {
      if (visibleCount <= 1) return; // siempre queda al menos una columna
      next.add(name);
    }
    persistHiddenColumns(resourceName, next);
    router.refresh();
  };

  const toggle = () => {
    const button = buttonRef.current;
    if (!button) return;
    setAnchor((current) => (current ? null : measureAnchor(button)));
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={Boolean(anchor)}
        aria-label="Columnas visibles"
        title="Columnas visibles"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--panel)] text-[var(--tx2)] transition hover:border-[var(--accent-bd)] hover:text-[var(--accent-tx)]"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16M15 4v16" />
        </svg>
      </button>
      {anchor ? (
        <FilterPanel
          anchor={anchor}
          title="Columnas"
          onClose={() => setAnchor(null)}
          ignoreRef={buttonRef}
        >
          <ul className="space-y-0.5">
            {columns.map((column) => {
              const visible = !hiddenSet.has(column.name);
              const lastVisible = visible && visibleCount <= 1;
              return (
                <li key={column.name}>
                  <label
                    className={`flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-[13px] text-[var(--tx)] transition hover:bg-[var(--panel2)] ${
                      lastVisible ? "opacity-60" : "cursor-pointer"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={visible}
                      disabled={lastVisible}
                      onChange={() => toggleColumn(column.name)}
                      className="accent-[var(--accent)]"
                    />
                    <span className="truncate">{column.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </FilterPanel>
      ) : null}
    </>
  );
}
