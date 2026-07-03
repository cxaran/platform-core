import { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

// Primitivo de boton (R2): consume tokens de tema (accent / on-accent / sombra).
// Soporta light y dark automaticamente via [data-theme]. API sin cambios.
export function Button({ className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`rounded-[11px] bg-[var(--accent)] px-[18px] py-2.5 text-sm font-semibold text-[var(--on-accent)] shadow-[var(--soft)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...props}
    />
  );
}
