import { HTMLAttributes } from "react";

type CardProps = HTMLAttributes<HTMLDivElement>;

// Primitivo de panel/tarjeta (R2): superficie elevada con tokens de tema
// (panel + borde + radio + sombra suave). Reutilizable; soporta light/dark.
export function Card({ className = "", ...props }: CardProps) {
  return (
    <div
      className={`rounded-[14px] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[var(--soft)] ${className}`}
      {...props}
    />
  );
}
