"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Acciones de fila con revelado animado (.rt-flyout). En dispositivos con puntero
 * las acciones aparecen al pasar el cursor por la fila (regla CSS sobre .rt-row);
 * la pestaña persistente (⋯) es el toggle explícito para táctil y teclado, donde
 * no existe hover. El estado abierto se cierra con Escape o al interactuar fuera.
 */
export function RowActionsFlyout({
  lead,
  children,
}: Readonly<{
  // Acción SIEMPRE VISIBLE (p. ej. el botón de chat del paciente): vive dentro del
  // ancla, entre el flyout y la pestaña, para que la píldora se despliegue a su
  // izquierda sin taparla.
  lead?: ReactNode;
  children: ReactNode;
}>) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const anchor = anchorRef.current;
      if (anchor && event.target instanceof Node && !anchor.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={anchorRef} className="rt-anchor gap-1.5" data-open={open ? "1" : "0"}>
      <div className="rt-flyout">{children}</div>
      {lead}
      <button
        type="button"
        className="rt-tab"
        aria-expanded={open}
        aria-label="Acciones de la fila"
        onClick={() => setOpen((value) => !value)}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.9" />
          <circle cx="12" cy="12" r="1.9" />
          <circle cx="12" cy="19" r="1.9" />
        </svg>
      </button>
    </div>
  );
}
