"use client";

// Banner-asistente del checklist de puesta en marcha (post-bootstrap). Tarjeta
// FLOTANTE (no toca el layout del shell), colapsable, con los ítems DERIVADOS del
// backend y enlace directo a la sección de cada uno. "Configurar después" persiste
// el descarte (el checklist sigue disponible en Configuración del sistema).

import Link from "next/link";
import { useState } from "react";

import { browserApi } from "@/core/api/browser-client";
import {
  itemRoute,
  type ChecklistItem,
  type SetupChecklist,
} from "@/core/system-settings/setup-checklist";

function StatusDot({ status }: Readonly<{ status: ChecklistItem["status"] }>) {
  if (status === "complete") {
    return <span className="text-[var(--ok,#2f9e68)]">✓</span>;
  }
  if (status === "not_applicable") {
    return <span className="text-[var(--tx3)]">—</span>;
  }
  return <span className="text-[var(--warn,#b47b12)]">●</span>;
}

export function SetupChecklistBanner({
  checklist,
}: Readonly<{ checklist: SetupChecklist }>) {
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  async function dismiss() {
    setHidden(true);
    try {
      await browserApi("/api/v1/system-settings/setup-checklist/dismiss", {
        method: "POST",
      });
    } catch {
      // Best-effort: si falla, el banner reaparecerá en la próxima carga.
    }
  }

  return (
    <aside
      aria-label="Checklist de puesta en marcha"
      className="fixed bottom-4 right-4 z-40 w-[340px] max-w-[calc(100vw-2rem)] rounded-[14px] border border-[var(--border2)] bg-[var(--panel)] shadow-[var(--soft)]"
    >
      <button
        type="button"
        onClick={() => setCollapsed((current) => !current)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-[var(--tx)]">
          Completa la configuración
        </span>
        <span className="rounded-full bg-[var(--warn-soft,rgba(245,159,10,0.15))] px-2 py-0.5 text-[11px] font-semibold text-[var(--warn,#b47b12)]">
          {checklist.pendingCount} pendiente{checklist.pendingCount === 1 ? "" : "s"}
        </span>
      </button>
      {!collapsed && (
        <div className="flex flex-col gap-1 px-4 pb-3">
          {checklist.items.map((item) => (
            <div key={item.key} className="flex items-start gap-2 py-1 text-sm">
              <StatusDot status={item.status} />
              <div className="min-w-0 flex-1">
                <p className="text-[var(--tx)]">{item.title}</p>
                <p className="truncate text-xs text-[var(--tx3)]" title={item.detail}>
                  {item.detail}
                </p>
              </div>
              {item.status === "pending" && (
                <Link
                  href={itemRoute(item.key)}
                  className="shrink-0 text-xs font-semibold text-[var(--accent)] hover:underline"
                >
                  Configurar
                </Link>
              )}
            </div>
          ))}
          <div className="mt-2 flex items-center justify-between">
            <Link
              href="/resources/system_settings"
              className="text-xs text-[var(--tx3)] hover:underline"
            >
              Configuración del sistema
            </Link>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-[8px] border border-[var(--border2)] bg-[var(--panel2)] px-2.5 py-1 text-xs font-semibold text-[var(--tx2)] transition hover:opacity-90"
            >
              Configurar después
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

/** Chip fijo de entorno NO productivo (esquina inferior izquierda). */
export function EnvironmentBadge({ environment }: Readonly<{ environment: string }>) {
  if (environment === "production") return null;
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-40 rounded-full border border-[var(--border2)] bg-[var(--panel)] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--tx3)] shadow-[var(--soft)]">
      Entorno: {environment === "local" ? "desarrollo" : environment}
    </div>
  );
}
