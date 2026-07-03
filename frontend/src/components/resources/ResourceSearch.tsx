"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { hrefWithParamUpdates } from "./filter-nav";

const DEBOUNCE_MS = 450;

/**
 * Búsqueda con debounce progresivo: al teclear se hace router.replace del ``q``
 * validado (mín. de caracteres del contrato) sin perder el foco. El <form
 * method="get"> queda como fallback sin JS: Enter envía el GET con los hidden
 * inputs que preservan el estado canónico (sort/limit/filtros).
 */
export function ResourceSearch({
  basePath,
  params,
  value,
  minLength,
  maxLength,
}: Readonly<{
  basePath: string;
  params: Readonly<Record<string, string>>;
  value: string;
  minLength: number;
  maxLength?: number;
}>) {
  const router = useRouter();
  const [text, setText] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    // Por debajo del mínimo no se navega (borrar todo sí limpia la búsqueda).
    if (trimmed !== "" && trimmed.length < minLength) return;
    const href = hrefWithParamUpdates(basePath, params, {
      q: trimmed === "" ? null : trimmed,
    });
    router.replace(href, { scroll: false });
  };

  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    setText(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => commit(next), DEBOUNCE_MS);
  };

  return (
    <form
      method="get"
      action={basePath}
      onSubmit={(event) => {
        event.preventDefault();
        if (timerRef.current) clearTimeout(timerRef.current);
        commit(text);
      }}
      className="relative min-w-[170px] max-w-[320px] flex-1"
    >
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--tx3)]"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-3.6-3.6" />
      </svg>
      <input
        type="search"
        name="q"
        value={text}
        onChange={onChange}
        minLength={minLength > 1 ? minLength : undefined}
        maxLength={maxLength}
        placeholder="Buscar…"
        aria-label="Buscar"
        title={minLength > 1 ? `Mínimo ${minLength} caracteres` : undefined}
        className="h-9 w-full rounded-[10px] border border-[var(--border2)] bg-[var(--bg2)] pl-9 pr-3 text-[13px] text-[var(--tx)] outline-none transition focus:border-[var(--accent-bd)]"
      />
      {/* Fallback sin JS: preserva sort/limit/filtros; offset reinicia. */}
      {Object.entries(params)
        .filter(([key]) => key !== "q" && key !== "offset")
        .map(([key, paramValue]) => (
          <input key={key} type="hidden" name={key} value={paramValue} />
        ))}
    </form>
  );
}
