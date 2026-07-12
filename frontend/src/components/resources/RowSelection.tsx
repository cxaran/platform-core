"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Selección múltiple de filas (estilo hoja de cálculo), como islas de cliente
 * alrededor de la tabla renderizada en servidor:
 *
 * - ``RowSelectionProvider`` guarda el estado (ids seleccionados) y conoce las
 *   filas de la página ACTUAL (ordenadas) para el rango con Shift+clic.
 * - ``RowSelectCheckbox`` es la celda-checkbox de cada fila.
 * - ``SelectAllCheckbox`` (encabezado) marca/desmarca la página visible.
 *
 * La selección vive solo en memoria de la página actual: cambiar de página o de
 * filtros la reinicia (el provider se re-monta con otras filas) — el mismo
 * comportamiento que una hoja al cambiar de vista.
 */

export type SelectableRow = { id: string; row: Record<string, unknown> };

type SelectionContextValue = {
  rows: readonly SelectableRow[];
  selectedIds: ReadonlySet<string>;
  toggle: (id: string, index: number, shiftKey: boolean) => void;
  setAll: (selected: boolean) => void;
  clear: () => void;
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function useRowSelection(): SelectionContextValue {
  const value = useContext(SelectionContext);
  if (!value) {
    throw new Error("useRowSelection requiere RowSelectionProvider.");
  }
  return value;
}

export function RowSelectionProvider({
  rows,
  children,
}: Readonly<{ rows: readonly SelectableRow[]; children: ReactNode }>) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const lastIndexRef = useRef<number | null>(null);

  const toggle = useCallback(
    (id: string, index: number, shiftKey: boolean) => {
      setSelectedIds((previous) => {
        const next = new Set(previous);
        const anchor = lastIndexRef.current;
        if (shiftKey && anchor !== null && anchor !== index) {
          // Rango estilo hoja: aplica el estado DESTINO (el del clic actual) a
          // todo el tramo entre el ancla y esta fila, inclusive.
          const start = Math.min(anchor, index);
          const end = Math.max(anchor, index);
          const target = !previous.has(id);
          for (let cursor = start; cursor <= end; cursor += 1) {
            const rowId = rows[cursor]?.id;
            if (!rowId) continue;
            if (target) {
              next.add(rowId);
            } else {
              next.delete(rowId);
            }
          }
        } else if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      lastIndexRef.current = index;
    },
    [rows],
  );

  const setAll = useCallback(
    (selected: boolean) => {
      lastIndexRef.current = null;
      setSelectedIds(selected ? new Set(rows.map((entry) => entry.id)) : new Set());
    },
    [rows],
  );

  const clear = useCallback(() => setAll(false), [setAll]);

  const value = useMemo(
    () => ({ rows, selectedIds, toggle, setAll, clear }),
    [rows, selectedIds, toggle, setAll, clear],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

const CHECKBOX_CLASS = "h-3.5 w-3.5 cursor-pointer accent-[var(--accent)]";

export function RowSelectCheckbox({
  id,
  index,
}: Readonly<{ id: string; index: number }>) {
  const { selectedIds, toggle } = useRowSelection();
  return (
    <input
      type="checkbox"
      checked={selectedIds.has(id)}
      aria-label="Seleccionar fila"
      onClick={(event) => toggle(id, index, event.shiftKey)}
      // onClick lleva el shiftKey; onChange queda para React (checkbox controlado).
      onChange={() => {}}
      className={CHECKBOX_CLASS}
    />
  );
}

export function SelectAllCheckbox() {
  const { rows, selectedIds, setAll } = useRowSelection();
  const allSelected = rows.length > 0 && rows.every((entry) => selectedIds.has(entry.id));
  const someSelected = selectedIds.size > 0 && !allSelected;
  return (
    <input
      type="checkbox"
      checked={allSelected}
      ref={(node) => {
        if (node) node.indeterminate = someSelected;
      }}
      aria-label="Seleccionar página"
      onChange={(event) => setAll(event.target.checked)}
      className={CHECKBOX_CLASS}
    />
  );
}
