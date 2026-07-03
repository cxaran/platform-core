import Link from "next/link";

import { AnimatedOrb } from "@/components/ui/AnimatedOrb";

/**
 * Marco visual común a las páginas públicas de auth — re-skin del LOGIN del diseño (MP-CTRL-0127):
 * marca centrada (orbe animado + "Platform Core"), título/descripción de la página y una tarjeta
 * de panel suave; con blobs decorativos a la deriva al fondo. SÓLO presentación (tokens de tema, sin
 * lógica de auth): cada página inyecta su formulario como ``children`` sin cambios de comportamiento.
 */
export function PublicAuthShell({
  title,
  description,
  children,
  footer,
}: Readonly<{
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}>) {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[var(--bg)] px-4 py-10 text-[var(--tx)]">
      {/* Blobs decorativos del diseño: a la deriva (blobdrift), sin captura de eventos. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -left-40 -top-44 h-[560px] w-[560px] rounded-full opacity-40 blur-[70px] [background:radial-gradient(circle,#a59bf6,transparent_68%)]"
          style={{ animation: "blobdrift-a 19s ease-in-out infinite" }}
        />
        <div
          className="absolute -bottom-40 -right-40 h-[520px] w-[520px] rounded-full opacity-30 blur-[72px] [background:radial-gradient(circle,#7fd9d0,transparent_68%)]"
          style={{ animation: "blobdrift-b 24s ease-in-out infinite" }}
        />
        <div
          className="absolute -top-28 right-[8%] h-[380px] w-[380px] rounded-full opacity-25 blur-[66px] [background:radial-gradient(circle,#f4a6c0,transparent_70%)]"
          style={{ animation: "blobdrift-c 27s ease-in-out infinite" }}
        />
      </div>

      <div className="relative z-[1] m-auto flex w-full max-w-[392px] flex-col items-center">
        <div className="orb-intro-soft">
          <AnimatedOrb size={84} />
        </div>
        <h1 className="text-blur-intro mt-5 text-[27px] font-semibold tracking-tight text-[var(--tx)]">
          Platform Core
        </h1>
        <h2 className="text-blur-intro-delay mt-2 text-center text-[14.5px] font-normal text-[var(--tx2)]">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-center text-sm text-[var(--tx3)]">{description}</p>
        ) : null}

        <div className="composer-intro mt-7 w-full rounded-[22px] bg-[var(--panel)] p-6 shadow-[var(--soft2)]">
          {children}
          {footer ? <div className="mt-6 text-sm text-[var(--tx2)]">{footer}</div> : null}
        </div>
      </div>
    </main>
  );
}

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
