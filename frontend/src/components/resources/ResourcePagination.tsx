import type { ReactNode } from "react";
import Link from "next/link";

import type { ResourceListPage } from "@/core/resources/list-types";

type Pagination = ResourceListPage["pagination"];

const CHIP =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-[9px] border border-[var(--border)] bg-[var(--panel)] px-2 text-[13px] text-[var(--tx2)] transition hover:bg-[var(--panel2)] hover:text-[var(--tx)]";
const CHIP_ACTIVE =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-[9px] border border-[var(--accent-bd)] bg-[var(--accent-dim)] px-2 text-[13px] font-semibold text-[var(--accent-tx)]";
const CHIP_DISABLED =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-[9px] border border-[var(--border)] px-2 text-[13px] text-[var(--tx3)] opacity-50";

/**
 * Opciones de "por página" según el total que reporta el backend: serie de
 * números preferidos 1–2–5 escalada por 10 ({1,2,5}×10ⁿ → 10, 20, 50, 100,
 * 200, 500, 1000…), cortada en el PRIMER valor mayor o igual al total (ese
 * incluido), sin exceder el max_limit del contrato. El límite activo se añade
 * si no cae en la serie, para que siempre se vea.
 */
function limitOptions(total: number, limit: number, maxLimit?: number): number[] {
  const cap = maxLimit ?? Number.POSITIVE_INFINITY;
  const options: number[] = [];
  outer: for (let magnitude = 10; ; magnitude *= 10) {
    for (const digit of [1, 2, 5]) {
      const value = digit * magnitude;
      if (value > cap) break outer;
      options.push(value);
      if (value >= total) break outer;
    }
  }
  if (limit <= cap && !options.includes(limit)) {
    options.push(limit);
  }
  return options.sort((a, b) => a - b);
}

// Ventana de páginas estilo 1 … 4 [5] 6 … 20 (primera/última siempre visibles).
function pageWindow(current: number, totalPages: number): (number | "gap")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const pages = new Set<number>([1, totalPages, current - 1, current, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous && p - previous > 1) out.push("gap");
    out.push(p);
    previous = p;
  }
  return out;
}

function rangeText(pagination: Pagination): string {
  const { total, offset, limit } = pagination;
  if (total === 0) return "Sin registros";
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return `${from}–${to} de ${total}`;
}

function Arrow({ direction }: Readonly<{ direction: "prev" | "next" }>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {direction === "prev" ? <path d="m15 18-6-6 6-6" /> : <path d="m9 18 6-6-6-6" />}
    </svg>
  );
}

// Flecha como Link (server, hrefs) o button (client, callbacks); deshabilitada = span.
function ArrowControl({
  direction,
  href,
  onClick,
  label,
}: Readonly<{
  direction: "prev" | "next";
  href?: string;
  onClick?: () => void;
  label: string;
}>) {
  const body = <Arrow direction={direction} />;
  if (href) {
    return (
      <Link href={href} rel={direction} aria-label={label} className={CHIP}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={label} className={CHIP}>
        {body}
      </button>
    );
  }
  return (
    <span aria-disabled="true" className={CHIP_DISABLED}>
      {body}
    </span>
  );
}

/**
 * Paginación de listas del contrato, sin islas de cliente en el modo servidor:
 * todo son Links que reescriben offset/limit en la URL.
 *
 * - variant="full": rango + números de página + "por página" (páginas /resources).
 * - variant="compact": SOLO flechas + rango, para contextos embebidos (record
 *   panel del chat) donde no debe robar espacio; acepta callbacks onPrev/onNext
 *   cuando el caller es cliente y pagina en memoria.
 */
export function ResourcePagination({
  pagination,
  variant = "full",
  prevHref,
  nextHref,
  onPrev,
  onNext,
  buildOffsetHref,
  buildLimitHref,
  maxLimit,
}: Readonly<{
  pagination: Pagination;
  variant?: "full" | "compact";
  prevHref?: string;
  nextHref?: string;
  onPrev?: () => void;
  onNext?: () => void;
  buildOffsetHref?: (offset: number) => string;
  buildLimitHref?: (limit: number) => string;
  maxLimit?: number;
}>) {
  const { total, limit, offset } = pagination;
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  const currentPage = limit > 0 ? Math.floor(offset / limit) + 1 : 1;

  if (variant === "compact") {
    // Una sola página completa: nada que paginar, no se roba espacio.
    if (total <= limit && offset === 0) return null;
    return (
      <div className="flex items-center justify-end gap-2">
        <span aria-live="polite" className="text-[12px] tabular-nums text-[var(--tx3)]">
          {rangeText(pagination)}
        </span>
        <ArrowControl
          direction="prev"
          href={prevHref}
          onClick={offset > 0 ? onPrev : undefined}
          label="Página anterior"
        />
        <ArrowControl
          direction="next"
          href={nextHref}
          onClick={pagination.has_next ? onNext : undefined}
          label="Página siguiente"
        />
      </div>
    );
  }

  // Sin registros: el estado vacío de la tabla ya lo comunica; no se roba espacio.
  if (total === 0) return null;

  let pages: ReactNode = null;
  if (buildOffsetHref && totalPages > 1) {
    pages = (
      <nav aria-label="Páginas" className="flex flex-wrap items-center gap-1">
        <ArrowControl
          direction="prev"
          href={offset > 0 ? buildOffsetHref(offset - limit) : undefined}
          label="Página anterior"
        />
        {pageWindow(currentPage, totalPages).map((entry, index) =>
          entry === "gap" ? (
            <span key={`gap-${index}`} aria-hidden="true" className="px-1 text-[var(--tx3)]">
              …
            </span>
          ) : (
            <Link
              key={entry}
              href={buildOffsetHref((entry - 1) * limit)}
              aria-current={entry === currentPage ? "page" : undefined}
              className={entry === currentPage ? CHIP_ACTIVE : CHIP}
            >
              {entry}
            </Link>
          ),
        )}
        <ArrowControl
          direction="next"
          href={pagination.has_next ? buildOffsetHref(offset + limit) : undefined}
          label="Página siguiente"
        />
      </nav>
    );
  }

  let limits: ReactNode = null;
  if (buildLimitHref) {
    const options = limitOptions(total, limit, maxLimit);
    if (options.length > 1) {
      limits = (
        <div className="flex items-center gap-1 text-[12.5px] text-[var(--tx3)]">
          <span>Por página:</span>
          {options.map((option) =>
            option === limit ? (
              <span key={option} className="px-1 font-semibold text-[var(--tx)]">
                {option}
              </span>
            ) : (
              <Link
                key={option}
                href={buildLimitHref(option)}
                className="px-1 text-[var(--tx2)] transition hover:text-[var(--accent-tx)]"
              >
                {option}
              </Link>
            ),
          )}
        </div>
      );
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      {/* aria-live: los lectores anuncian el nuevo rango al aplicar filtros/búsqueda. */}
      <p aria-live="polite" className="text-[13px] tabular-nums text-[var(--tx3)]">
        {rangeText(pagination)}
      </p>
      <div className="flex flex-wrap items-center gap-4">
        {limits}
        {pages}
      </div>
    </div>
  );
}
