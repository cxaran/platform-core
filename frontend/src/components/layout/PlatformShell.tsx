"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { AccountMenu } from "@/components/layout/AccountMenu";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { AnimatedOrb } from "@/components/ui/AnimatedOrb";
import type { ResourceCatalog as ResourceCatalogType } from "@/core/api/contracts";
import type { SessionUser } from "@/core/auth/types";

// Recursos con página propia fuera del listado genérico (p. ej. el visor de respaldos).
const CUSTOM_RESOURCE_ROUTES: Record<string, string> = {
  backup_settings: "/backups",
  backup_runs: "/backups",
};

function resourceHref(name: string): string {
  return CUSTOM_RESOURCE_ROUTES[name] ?? `/resources/${encodeURIComponent(name)}`;
}

function deriveTitle(pathname: string, resources: ResourceCatalogType): string {
  if (pathname === "/") return "Inicio";
  if (pathname.startsWith("/account")) return "Mi cuenta";
  if (pathname.startsWith("/backups")) return "Respaldos";
  if (pathname.startsWith("/resources/")) {
    const name = decodeURIComponent(pathname.split("/")[2] ?? "");
    return resources.find((resource) => resource.name === name)?.label ?? "Recursos";
  }
  return "Platform Core";
}

/**
 * Cromo autenticado del producto: sidebar fija en escritorio (drawer en móvil vía las
 * clases .mc-sidebar de globals.css), header con el título derivado de la ruta y el
 * contenido con scroll propio. La navegación se deriva del CONTRATO de recursos
 * visible para la sesión (RBAC del backend); no hay rutas cableadas por rol.
 */
export function PlatformShell({
  session,
  resources,
  children,
}: Readonly<{
  session: SessionUser;
  resources: ResourceCatalogType;
  children: React.ReactNode;
}>) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const title = deriveTitle(pathname, resources);
  // El visor de respaldos agrupa sus dos recursos en una sola entrada.
  const seen = new Set<string>();
  const navItems = resources.filter((resource) => {
    const href = resourceHref(resource.name);
    if (seen.has(href)) return false;
    seen.add(href);
    return true;
  });

  return (
    <div
      className="flex h-dvh overflow-hidden bg-[var(--bg)] text-[var(--tx)]"
      data-nav-open={navOpen ? "1" : "0"}
    >
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className="mc-sidebar-backdrop fixed inset-0 z-30 bg-black/40"
        onClick={() => setNavOpen(false)}
      />
      <aside className="mc-sidebar z-40 flex w-64 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)]">
        <Link href="/" className="flex items-center gap-3 px-5 py-4" onClick={() => setNavOpen(false)}>
          <AnimatedOrb size={30} />
          <span className="text-base font-semibold tracking-tight">Platform Core</span>
        </Link>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2" aria-label="Recursos">
          <Link
            href="/"
            onClick={() => setNavOpen(false)}
            className={`block rounded-[10px] px-3 py-2 text-sm font-medium transition ${
              pathname === "/"
                ? "bg-[var(--panel2)] text-[var(--tx)]"
                : "text-[var(--tx2)] hover:bg-[var(--panel2)] hover:text-[var(--tx)]"
            }`}
          >
            Inicio
          </Link>
          {navItems.map((resource) => {
            const href = resourceHref(resource.name);
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={resource.name}
                href={href}
                onClick={() => setNavOpen(false)}
                className={`block rounded-[10px] px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-[var(--panel2)] text-[var(--tx)]"
                    : "text-[var(--tx2)] hover:bg-[var(--panel2)] hover:text-[var(--tx)]"
                }`}
              >
                {resource.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-3">
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium">{session.name}</p>
            <p className="truncate text-xs text-[var(--tx3)]">{session.email}</p>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <AccountMenu />
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[62px] shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--panel)] px-4 sm:px-6">
          <button
            type="button"
            className="mc-menu-btn h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--border)] text-[var(--tx2)]"
            aria-label="Abrir navegación"
            onClick={() => setNavOpen((open) => !open)}
          >
            ☰
          </button>
          {/* Título del cromo, NO un heading: cada página aporta su propio h1/h2
              (evita headings duplicados para lectores de pantalla y tests). */}
          <p className="truncate text-lg font-semibold">{title}</p>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
