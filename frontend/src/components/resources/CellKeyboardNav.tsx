"use client";

import { useEffect } from "react";

/**
 * Navegación de teclado por celdas (estilo hoja de cálculo) sobre la tabla
 * renderizada en servidor. Sin estado propio: opera sobre el DOM real.
 *
 * - Clic en una celda la enfoca (los ``td`` llevan ``tabindex="-1"``).
 * - Flechas: mover la celda activa; Home/End: extremos de la fila.
 * - Ctrl/Cmd+C con una celda activa: copia su texto visible.
 * - Enter: entra al primer control de la celda (enlace, botón o editor inline);
 *   Escape desde un control devuelve el foco a la celda.
 *
 * Respeta la edición: si el foco está en un input/select/textarea no intercepta
 * nada (ahí mandan los atajos del editor).
 */

const CELL_SELECTOR = "td[data-rt-cell]";

function isEditingContext(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "SELECT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  );
}

function activeCell(): HTMLTableCellElement | null {
  const active = document.activeElement;
  return active instanceof HTMLTableCellElement && active.matches(CELL_SELECTOR)
    ? active
    : null;
}

function moveFocus(cell: HTMLTableCellElement, rowDelta: number, colDelta: number): void {
  const row = cell.parentElement;
  if (!(row instanceof HTMLTableRowElement)) return;
  const cells = [...row.querySelectorAll<HTMLTableCellElement>(CELL_SELECTOR)];
  const columnIndex = cells.indexOf(cell);

  if (colDelta !== 0) {
    const target =
      colDelta === Number.NEGATIVE_INFINITY
        ? cells[0]
        : colDelta === Number.POSITIVE_INFINITY
          ? cells[cells.length - 1]
          : cells[columnIndex + colDelta];
    target?.focus();
    return;
  }

  const body = row.parentElement;
  if (!body) return;
  const rows = [...body.querySelectorAll<HTMLTableRowElement>("tr")];
  const targetRow = rows[rows.indexOf(row) + rowDelta];
  if (!targetRow) return;
  const targetCells = [...targetRow.querySelectorAll<HTMLTableCellElement>(CELL_SELECTOR)];
  (targetCells[columnIndex] ?? targetCells[targetCells.length - 1])?.focus();
}

export function CellKeyboardNav() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditingContext(event.target)) {
        return;
      }
      const cell = activeCell();
      if (!cell) return;

      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          moveFocus(cell, -1, 0);
          return;
        case "ArrowDown":
          event.preventDefault();
          moveFocus(cell, 1, 0);
          return;
        case "ArrowLeft":
          event.preventDefault();
          moveFocus(cell, 0, -1);
          return;
        case "ArrowRight":
          event.preventDefault();
          moveFocus(cell, 0, 1);
          return;
        case "Home":
          event.preventDefault();
          moveFocus(cell, 0, Number.NEGATIVE_INFINITY);
          return;
        case "End":
          event.preventDefault();
          moveFocus(cell, 0, Number.POSITIVE_INFINITY);
          return;
        case "Enter": {
          const focusable = cell.querySelector<HTMLElement>(
            "a, button, [data-editable-cell]",
          );
          if (focusable) {
            event.preventDefault();
            focusable.focus();
          }
          return;
        }
        case "c":
        case "C": {
          if (!(event.ctrlKey || event.metaKey)) return;
          // Sin selección de texto del usuario: copia la celda activa.
          if ((window.getSelection()?.toString() ?? "") !== "") return;
          event.preventDefault();
          void navigator.clipboard.writeText(cell.innerText.trim());
          return;
        }
        default:
      }
    };

    const onEscape = (event: KeyboardEvent) => {
      // Escape desde un control interno devuelve el foco a su celda.
      if (event.key !== "Escape" || !(event.target instanceof HTMLElement)) return;
      const cell = event.target.closest<HTMLTableCellElement>(CELL_SELECTOR);
      if (cell && event.target !== cell) {
        cell.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  return null;
}
