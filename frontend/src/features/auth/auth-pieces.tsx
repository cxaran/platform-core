// Piezas compartidas de las páginas públicas de auth (client-safe: las importan
// formularios "use client"). Separadas de PublicAuthShell para que el shell pueda
// ser un server component async (lee la marca real con imports server-only).

import Link from "next/link";

export function AuthLink({ href, children }: Readonly<{ href: string; children: React.ReactNode }>) {
  return (
    <Link
      href={href}
      className="font-medium text-[var(--accent-tx)] underline-offset-2 hover:underline"
    >
      {children}
    </Link>
  );
}

/**
 * Mensaje de estado en bloque (error/ok) con tokens de tema. Reutilizable por los
 * formularios públicos para no duplicar estilos; soporta light y dark.
 */
export function AuthAlert({
  tone,
  role = "status",
  children,
}: Readonly<{ tone: "danger" | "ok"; role?: "alert" | "status"; children: React.ReactNode }>) {
  const toneClass =
    tone === "danger"
      ? "border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-[var(--danger)]"
      : "border-[color-mix(in_srgb,var(--ok)_35%,transparent)] bg-[color-mix(in_srgb,var(--ok)_13%,transparent)] text-[var(--ok)]";
  return (
    <div role={role} className={`rounded-[11px] border px-4 py-3 text-sm ${toneClass}`}>
      {children}
    </div>
  );
}

/** Label estándar de los formularios públicos. */
export function AuthLabel({
  htmlFor,
  children,
}: Readonly<{ htmlFor: string; children: React.ReactNode }>) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium text-[var(--tx2)]">
      {children}
    </label>
  );
}
