import { SelectHTMLAttributes } from "react";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

// Primitivo de seleccion (R2): mismo lenguaje visual que Input (borde/fondo con
// tokens, foco con acento). Soporta light y dark via [data-theme].
export function Select({ className = "", children, ...props }: SelectProps) {
  return (
    <select
      className={`w-full rounded-[11px] border border-[var(--border2)] bg-[var(--bg2)] px-3 py-2.5 text-sm text-[var(--tx)] outline-none transition focus:border-[var(--accent-bd)] focus:shadow-[var(--glow)] disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}
