import { InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

// Primitivo de campo de texto (R2): borde/fondo con tokens y foco con acento
// (borde accent-bd + glow). Soporta light y dark via [data-theme].
export function Input({ className = "", ...props }: InputProps) {
  return (
    <input
      className={`w-full rounded-[11px] border border-[var(--border2)] bg-[var(--bg2)] px-3 py-2.5 text-sm text-[var(--tx)] outline-none transition focus:border-[var(--accent-bd)] focus:shadow-[var(--glow)] disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...props}
    />
  );
}
