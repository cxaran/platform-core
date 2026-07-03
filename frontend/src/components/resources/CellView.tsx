import type { FieldValueType } from "@/core/api/contracts";

import { LocalDate, LocalDateTime } from "./LocalDateTime";
import { formatCell } from "./format-cell";

/**
 * Celda consciente del tipo declarado por la capability. Mantiene la garantía de
 * formatCell: el valor crudo JAMÁS se interpreta como HTML — todo texto lo escapa
 * React, y los únicos elementos que se emiten aquí son fijos (badge, mailto con
 * esquema constante, islas de fecha). Cualquier caso no cubierto cae al texto
 * plano seguro de formatCell.
 */

// Tinte de GUÍA para estados comunes (presentación, no semántica del contrato):
// un valor fuera de estos sets cae al badge neutro.
const BADGE_OK = new Set(["active", "confirmed", "attended", "completed", "done", "approved", "resolved"]);
const BADGE_DANGER = new Set(["cancelled", "canceled", "rejected", "no_show", "deleted", "expired", "blocked"]);
const BADGE_WARN = new Set(["pending", "draft", "in_progress", "rescheduled", "on_hold"]);

const BADGE_BASE =
  "inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[12px] font-medium";

function badgeClass(value: string): string {
  if (BADGE_OK.has(value)) {
    return `${BADGE_BASE} bg-[color-mix(in_srgb,var(--ok)_13%,transparent)] text-[var(--ok)]`;
  }
  if (BADGE_DANGER.has(value)) {
    return `${BADGE_BASE} bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-[var(--danger)]`;
  }
  if (BADGE_WARN.has(value)) {
    return `${BADGE_BASE} bg-[color-mix(in_srgb,var(--warn)_14%,transparent)] text-[var(--warn)]`;
  }
  return `${BADGE_BASE} border border-[var(--border2)] bg-[var(--panel2)] text-[var(--tx2)]`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CellView({
  value,
  type,
  enumLabels,
  className,
}: Readonly<{
  value: unknown;
  type: FieldValueType;
  // value → label del contrato (ResourceFilterOption) para columnas enum.
  enumLabels?: ReadonlyMap<string, string>;
  className: string;
}>) {
  // Fechas: zona y formato regional del navegador (islas cliente).
  if (type === "datetime") {
    return <LocalDateTime value={value} className={className} />;
  }
  if (type === "date") {
    return <LocalDate value={value} className={className} />;
  }

  if (type === "enum" && typeof value === "string" && value !== "") {
    const label = enumLabels?.get(value) ?? value;
    return (
      <span className={className} title={label}>
        <span className={badgeClass(value)}>{label}</span>
      </span>
    );
  }

  // mailto: esquema FIJO; el valor va URI-encodeado en el href y escapado por
  // React en el texto. Un valor que no parece correo cae a texto plano.
  if (type === "email" && typeof value === "string" && EMAIL_RE.test(value)) {
    return (
      <a
        href={`mailto:${encodeURIComponent(value)}`}
        title={value}
        className={`${className} text-[var(--accent-tx)] underline-offset-2 hover:underline`}
      >
        {value}
      </a>
    );
  }

  const text = formatCell(value, type);
  return (
    <span className={className} title={text}>
      {text}
    </span>
  );
}
