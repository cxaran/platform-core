"use client";

import { useSyncExternalStore } from "react";

import { formatCell, parseDateTimeMs } from "./format-cell";

const DASH = "—";

const emptySubscribe = () => () => {};

// true sólo tras hidratar; en SSR y en el primer render del cliente devuelve false,
// así el texto inicial coincide con el del servidor (sin mismatch ni setState-en-efecto).
function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

// Fecha-hora en la zona Y formato regional del navegador (p. ej. "30 jun 2026, 11:23 a.m.").
function localDateTimeText(value: unknown): string {
  const ms = parseDateTimeMs(value);
  if (ms === null) return DASH;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(ms));
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

// Fecha civil en formato regional (p. ej. "31 may 2025"). Se construye por partes,
// nunca con Date.parse: una fecha sin hora no debe desplazarse de día por zona horaria.
function localDateText(value: unknown): string {
  if (typeof value !== "string") return DASH;
  const match = DATE_ONLY.exec(value);
  if (!match) return DASH;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

/**
 * Fecha-hora en la zona horaria y formato regional del NAVEGADOR. El servidor no los
 * conoce, así que el SSR emite el texto determinista en UTC (formatCell) y tras
 * hidratar se sustituye por la versión local. El title conserva el UTC como
 * referencia inequívoca.
 */
export function LocalDateTime({
  value,
  className,
}: Readonly<{ value: unknown; className?: string }>) {
  const utc = formatCell(value, "datetime");
  const hydrated = useHydrated();
  const text = hydrated && utc !== DASH ? localDateTimeText(value) : utc;
  return (
    <span className={className} title={utc === DASH ? undefined : utc}>
      {text}
    </span>
  );
}

/**
 * Fecha sin hora en el formato regional del navegador. SSR emite el ISO
 * ("YYYY-MM-DD", determinista) y tras hidratar se sustituye por el formato local;
 * el title conserva el ISO.
 */
export function LocalDate({
  value,
  className,
}: Readonly<{ value: unknown; className?: string }>) {
  const iso = formatCell(value, "date");
  const hydrated = useHydrated();
  const text = hydrated && iso !== DASH ? localDateText(value) : iso;
  return (
    <span className={className} title={iso === DASH ? undefined : iso}>
      {text}
    </span>
  );
}
