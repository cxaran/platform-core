"use client";

import { useEffect } from "react";

/**
 * Atajos de teclado de la lista de recursos (SIN UI: solo funcionalidad, con
 * las convenciones habituales de las web apps):
 *
 * - "/"            → enfoca la búsqueda.
 * - "f"            → abre el popover "+ Filtro".
 * - "j" / "k"      → fila siguiente / anterior (foco itinerante).
 * - "↓" / "↑"      → igual, pero SOLO si ya hay una fila enfocada (no roba el
 *                    scroll normal de la página).
 * - "Enter"        → abre el detalle ("Ver") de la fila enfocada.
 * - "Escape"       → suelta el foco de la fila.
 * - "←" / "→"      → página anterior / siguiente (clic en las flechas reales
 *                    de la paginación: la lógica de límites sigue en el server).
 * - "Ctrl/Cmd+P"   → imprimir: abre el diálogo de exportación en PDF.
 *
 * Guardas: nada aplica mientras se escribe en un input/textarea/select, con un
 * diálogo abierto, o con modificadores (salvo Ctrl+P). No renderiza nada.
 */

export const OPEN_EXPORT_EVENT = "rt:open-export";

function isTyping(): boolean {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement)) return false;
  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT" ||
    element.isContentEditable
  );
}

function dialogOpen(): boolean {
  return document.querySelector('[role="dialog"]') !== null;
}

function tableRows(): HTMLTableRowElement[] {
  return [...document.querySelectorAll<HTMLTableRowElement>("tr.rt-row")];
}

function focusRow(delta: 1 | -1): void {
  const rows = tableRows();
  if (rows.length === 0) return;
  const active = document.activeElement;
  const currentIndex = active instanceof HTMLTableRowElement ? rows.indexOf(active) : -1;
  const nextIndex =
    currentIndex === -1
      ? delta === 1
        ? 0
        : rows.length - 1
      : Math.min(rows.length - 1, Math.max(0, currentIndex + delta));
  const row = rows[nextIndex];
  row.tabIndex = -1;
  row.focus({ preventScroll: true });
  row.scrollIntoView({ block: "nearest" });
}

function clickIfLink(selector: string): void {
  document.querySelector<HTMLElement>(selector)?.click();
}

export function TableHotkeys(): null {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Imprimir: Ctrl/Cmd+P → exportación en PDF (con vista previa imprimible).
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "p") {
        if (dialogOpen()) return;
        event.preventDefault();
        document.dispatchEvent(
          new CustomEvent(OPEN_EXPORT_EVENT, { detail: { format: "pdf" } }),
        );
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (dialogOpen() || isTyping()) return;

      const rowFocused = document.activeElement instanceof HTMLTableRowElement;

      switch (event.key) {
        case "/":
          event.preventDefault();
          document.querySelector<HTMLInputElement>('input[name="q"]')?.focus();
          break;
        case "f":
        case "F":
          event.preventDefault();
          clickIfLink('[data-hotkey="add-filter"]');
          break;
        case "j":
          event.preventDefault();
          focusRow(1);
          break;
        case "k":
          event.preventDefault();
          focusRow(-1);
          break;
        case "ArrowDown":
          if (rowFocused) {
            event.preventDefault();
            focusRow(1);
          }
          break;
        case "ArrowUp":
          if (rowFocused) {
            event.preventDefault();
            focusRow(-1);
          }
          break;
        case "Enter":
          if (rowFocused) {
            event.preventDefault();
            (document.activeElement as HTMLElement)
              .querySelector<HTMLElement>("[data-row-detail]")
              ?.click();
          }
          break;
        case "Escape":
          if (rowFocused) (document.activeElement as HTMLElement).blur();
          break;
        case "ArrowRight":
          if (!rowFocused) clickIfLink('a[aria-label="Página siguiente"]');
          break;
        case "ArrowLeft":
          if (!rowFocused) clickIfLink('a[aria-label="Página anterior"]');
          break;
        default:
          break;
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
