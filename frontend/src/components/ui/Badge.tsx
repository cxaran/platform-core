import { HTMLAttributes } from "react";

export type BadgeTone = "neutral" | "accent" | "danger" | "warn" | "ok" | "info";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

// Tonos semanticos derivados de los tokens de tema. Para los estados (danger/
// warn/ok/info) el fondo es una mezcla translucida del color del token, de modo
// que el contraste se mantiene tanto en light como en dark sin hardcodear.
const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "bg-[var(--panel2)] text-[var(--tx2)]",
  accent: "bg-[var(--accent-dim)] text-[var(--accent-tx)]",
  danger: "bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] text-[var(--danger)]",
  warn: "bg-[color-mix(in_srgb,var(--warn)_16%,transparent)] text-[var(--warn)]",
  ok: "bg-[color-mix(in_srgb,var(--ok)_15%,transparent)] text-[var(--ok)]",
  info: "bg-[color-mix(in_srgb,var(--info)_14%,transparent)] text-[var(--info)]",
};

// Primitivo de etiqueta/estado (R2): pildora compacta con tono semantico.
export function Badge({ tone = "neutral", className = "", ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASS[tone]} ${className}`}
      {...props}
    />
  );
}
