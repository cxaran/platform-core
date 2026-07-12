"use client";

import { useEffect, useMemo, useState } from "react";

import { fetchResourceFacets } from "@/core/resources/facets-client";
import { joinMultiValue, splitMultiValue } from "@/core/resources/filterable";

/**
 * Checklist de valores únicos de una columna (autofiltro estilo Excel).
 *
 * Dos universos:
 * - Cerrado (``options``: enum/select del contrato): lista estática con labels.
 * - Abierto (``facets``): valores + conteos del endpoint de facetas, calculados
 *   bajo los filtros de las DEMÁS columnas (el backend excluye el propio).
 *
 * El valor es la forma canónica unida (MULTI_VALUE_SEPARATOR); aquí solo se
 * marca/desmarca — aplicar/limpiar lo decide el FilterEditor que la contiene.
 */

type Entry = { value: string; label?: string; count?: number };

const ROW_CLASS =
  "flex cursor-pointer items-center gap-2 rounded-[7px] px-1.5 py-1 text-[13px] text-[var(--tx)] transition hover:bg-[var(--panel2)]";

export function FacetChecklist({
  fieldKey,
  value,
  onChange,
  options,
  facets,
  maxValues,
}: Readonly<{
  fieldKey: string;
  value: string;
  onChange: (joined: string) => void;
  options?: readonly { value: string; label: string }[];
  facets?: { url: string; params: Readonly<Record<string, string>> };
  maxValues?: number;
}>) {
  const selected = useMemo(() => new Set(splitMultiValue(value)), [value]);
  const openUniverse = !(options && options.length > 0);
  // Universo cerrado → estático desde el contrato; abierto sin facetas → vacío
  // (solo se listan los ya seleccionados); abierto con facetas → null hasta cargar.
  const [entries, setEntries] = useState<Entry[] | null>(() => {
    if (!openUniverse) return options!.map((option) => ({ ...option }));
    return facets ? null : [];
  });
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!openUniverse || !facets) return;
    let cancelled = false;
    fetchResourceFacets(facets.url, fieldKey, facets.params)
      .then((response) => {
        if (cancelled) return;
        setEntries(response.values.map((entry) => ({ value: entry.value, count: entry.count })));
        setHasMore(response.has_more);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [openUniverse, facets, fieldKey]);

  // Los valores ya seleccionados que la faceta no devolvió (p. ej. quedaron fuera
  // del top-N o del filtro actual) se conservan visibles y marcados: desmarcar
  // debe ser siempre posible.
  const allEntries = useMemo(() => {
    const base = entries ?? [];
    const known = new Set(base.map((entry) => entry.value));
    const extras = [...selected]
      .filter((item) => !known.has(item))
      .map((item) => ({ value: item }) as Entry);
    return [...extras, ...base];
  }, [entries, selected]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term === "") return allEntries;
    return allEntries.filter((entry) =>
      (entry.label ?? entry.value).toLowerCase().includes(term),
    );
  }, [allEntries, search]);

  const atCap = maxValues !== undefined && selected.size >= maxValues;

  const toggle = (entryValue: string) => {
    const next = new Set(selected);
    if (next.has(entryValue)) {
      next.delete(entryValue);
    } else {
      if (atCap) return;
      next.add(entryValue);
    }
    onChange(joinMultiValue([...next]));
  };

  const selectVisible = () => {
    const next = new Set(selected);
    for (const entry of visible) {
      if (maxValues !== undefined && next.size >= maxValues) break;
      next.add(entry.value);
    }
    onChange(joinMultiValue([...next]));
  };

  if (error) {
    return (
      <p className="px-1 text-[12.5px] text-[var(--tx3)]">
        No se pudieron cargar los valores de esta columna.
      </p>
    );
  }
  if (entries === null && openUniverse && facets) {
    return <p className="px-1 text-[12.5px] text-[var(--tx3)]">Cargando valores…</p>;
  }

  return (
    <div className="space-y-1.5">
      {allEntries.length > 8 || hasMore ? (
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar valores…"
          aria-label="Buscar valores"
          className="w-full rounded-[9px] border border-[var(--border2)] bg-[var(--bg2)] px-2.5 py-1.5 text-[13px] text-[var(--tx)] outline-none transition focus:border-[var(--accent-bd)]"
        />
      ) : null}
      <div className="flex items-center gap-2 px-1 text-[11.5px] font-medium text-[var(--tx3)]">
        <button
          type="button"
          onClick={selectVisible}
          className="transition hover:text-[var(--accent-tx)]"
        >
          Marcar visibles
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          onClick={() => onChange("")}
          className="transition hover:text-[var(--accent-tx)]"
        >
          Ninguno
        </button>
        {selected.size > 0 ? <span className="ml-auto">{selected.size} elegido(s)</span> : null}
      </div>
      <ul className="max-h-52 space-y-0.5 overflow-y-auto pr-1" role="listbox" aria-multiselectable>
        {visible.map((entry) => {
          const checked = selected.has(entry.value);
          return (
            <li key={entry.value}>
              <label className={ROW_CLASS}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && atCap}
                  onChange={() => toggle(entry.value)}
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
                <span className="min-w-0 flex-1 truncate">{entry.label ?? entry.value}</span>
                {entry.count !== undefined ? (
                  <span className="shrink-0 text-[11.5px] tabular-nums text-[var(--tx3)]">
                    {entry.count}
                  </span>
                ) : null}
              </label>
            </li>
          );
        })}
        {visible.length === 0 ? (
          <li className="px-1.5 py-1 text-[12.5px] text-[var(--tx3)]">Sin valores.</li>
        ) : null}
      </ul>
      {hasMore ? (
        <p className="px-1 text-[11.5px] text-[var(--tx3)]">
          Se muestran los valores más frecuentes; usa la búsqueda de la lista para el resto.
        </p>
      ) : null}
    </div>
  );
}
