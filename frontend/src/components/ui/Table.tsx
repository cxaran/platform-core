import { HTMLAttributes, TableHTMLAttributes, ThHTMLAttributes, TdHTMLAttributes } from "react";

// Primitivos de tabla (R2): estilos base (header/filas/hover/bordes) con tokens
// de tema. Composables y reutilizables; soportan light y dark via [data-theme].

export function Table({ className = "", ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={`w-full border-collapse text-sm ${className}`} {...props} />;
}

export function THead({ className = "", ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={`border-b border-[var(--border)] bg-[var(--bg2)] text-left text-xs font-semibold uppercase tracking-wide text-[var(--tx3)] ${className}`}
      {...props}
    />
  );
}

export function TBody({ className = "", ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}

export function Tr({ className = "", ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={`border-b border-[var(--border)] transition hover:bg-[var(--bg2)] ${className}`}
      {...props}
    />
  );
}

export function Th({ className = "", ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={`px-3 py-2.5 ${className}`} {...props} />;
}

export function Td({ className = "", ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`px-3 py-2.5 text-[var(--tx)] ${className}`} {...props} />;
}
