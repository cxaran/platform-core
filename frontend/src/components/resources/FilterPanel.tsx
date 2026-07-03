"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { useFocusTrap } from "./use-focus-trap";

/**
 * Contenedor de los menús de filtro (popover estilo Excel). Va en un PORTAL al
 * body con position:fixed, así no lo recorta el overflow de la tabla ni lo
 * limita el largo de esta. El caller mide el ancla EN EL CLICK y pasa el rect
 * (nada de setState en efectos); si el viewport es angosto o el panel no cabe
 * anclado, se muestra como diálogo centrado con backdrop. Cierra con Escape,
 * click fuera, o scroll/resize (el ancla se mueve → mejor cerrar que flotar mal).
 */

export type AnchorRect = { top: number; bottom: number; left: number; right: number };

const PANEL_WIDTH = 300;
const MARGIN = 8;
const DIALOG_BREAKPOINT = 560;

export function measureAnchor(element: HTMLElement): AnchorRect {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
}

export function FilterPanel({
  anchor,
  title,
  onClose,
  ignoreRef,
  children,
}: Readonly<{
  anchor: AnchorRect;
  title: string;
  onClose: () => void;
  // Ref del botón disparador: sus clicks no cuentan como "fuera" (él alterna).
  ignoreRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}>) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Foco: entra al primer control al abrir, Tab cicla dentro, y al cerrar
  // regresa al disparador.
  useFocusTrap(panelRef);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const panel = panelRef.current;
      if (!(event.target instanceof Node)) return;
      if (ignoreRef?.current?.contains(event.target)) return;
      if (panel && !panel.contains(event.target)) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // Scroll de la página/tabla → cerrar (el ancla se movió); el scroll INTERNO
    // del panel no cierra.
    const onMove = (event?: Event) => {
      if (
        event &&
        event.target instanceof Node &&
        panelRef.current?.contains(event.target)
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [onClose, ignoreRef]);

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const asDialog =
    viewportWidth < DIALOG_BREAKPOINT || anchor.bottom + 160 > viewportHeight;

  const body = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={title}
      tabIndex={-1}
      className="rounded-[12px] border border-[var(--border)] bg-[var(--elev)] shadow-[var(--soft2)] outline-none"
      style={
        asDialog
          ? {
              position: "fixed",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              width: `min(${PANEL_WIDTH + 40}px, calc(100vw - 24px))`,
              maxHeight: "80vh",
              overflow: "auto",
              zIndex: 101,
            }
          : {
              position: "fixed",
              top: Math.round(anchor.bottom + 6),
              left: Math.round(
                Math.min(
                  Math.max(MARGIN, anchor.right - PANEL_WIDTH),
                  viewportWidth - PANEL_WIDTH - MARGIN,
                ),
              ),
              width: PANEL_WIDTH,
              maxHeight: `min(70vh, ${Math.max(180, viewportHeight - anchor.bottom - 16)}px)`,
              overflow: "auto",
              zIndex: 101,
            }
      }
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <span className="text-[12.5px] font-semibold text-[var(--tx)]">{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="rounded-[8px] p-1 text-[var(--tx3)] transition hover:bg-[var(--panel2)] hover:text-[var(--tx)]"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );

  return createPortal(
    asDialog ? (
      <>
        <div
          aria-hidden="true"
          className="fixed inset-0 z-[100] bg-[rgba(20,17,16,0.35)]"
          onPointerDown={onClose}
        />
        {body}
      </>
    ) : (
      body
    ),
    document.body,
  );
}
