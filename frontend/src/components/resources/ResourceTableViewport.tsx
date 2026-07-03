"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Contenedor de scroll horizontal de la tabla. Publica en data-attributes si hay
 * contenido recortado hacia cada lado (data-clip-left / data-clip-right) para que
 * el CSS (.rt-shade-*) muestre las sombras de borde y la columna sticky de acciones
 * se lea separada del contenido que pasa por debajo. Solo observa el layout: muta
 * atributos del DOM directamente, sin re-render de React por cada scroll.
 */
export function ResourceTableViewport({
  children,
  scrollerClassName,
}: Readonly<{
  children: ReactNode;
  // p. ej. "max-h-[70vh]": acota el alto y habilita el scroll vertical interno
  // sobre el que trabaja el header sticky (.rt-thead).
  scrollerClassName?: string;
}>) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const scroller = scrollerRef.current;
    if (!viewport || !scroller) return;

    const update = () => {
      // Tolerancia de 1px por redondeo de subpíxeles en zoom/DPI fraccional.
      const clipLeft = scroller.scrollLeft > 1;
      const clipRight = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1;
      viewport.dataset.clipLeft = clipLeft ? "1" : "0";
      viewport.dataset.clipRight = clipRight ? "1" : "0";
      // Recorte vertical: dispara la sombra bajo el header sticky.
      viewport.dataset.clipTop = scroller.scrollTop > 1 ? "1" : "0";
    };

    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    // La tabla puede cambiar de ancho sin que cambie el contenedor (columnas, datos).
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    return () => {
      scroller.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={viewportRef} className="rt-viewport">
      <div ref={scrollerRef} className={`rt-scroller ${scrollerClassName ?? ""}`}>
        {children}
      </div>
      <div aria-hidden="true" className="rt-shade rt-shade-left" />
      <div aria-hidden="true" className="rt-shade rt-shade-right" />
    </div>
  );
}
