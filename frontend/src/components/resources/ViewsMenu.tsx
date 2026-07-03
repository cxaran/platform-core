"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { FilterPanel, measureAnchor, type AnchorRect } from "./FilterPanel";

/**
 * Vistas guardadas POR RECURSO: el estado canónico actual (búsqueda + filtros +
 * orden + límite, sin offset) se guarda con nombre en localStorage y aplicar
 * una vista navega a su URL — la URL sigue siendo el único estado de la lista.
 * localStorage (no cookie): es una conveniencia del cliente, el server no la
 * necesita para renderizar.
 */

type SavedView = { name: string; qs: string };

function storageKey(resourceName: string): string {
  return `rtviews_${resourceName}`;
}

// Fuera del componente: React Compiler no permite mutar storage en su cuerpo.
function readViews(resourceName: string): SavedView[] {
  try {
    const raw = localStorage.getItem(storageKey(resourceName));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is SavedView =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as SavedView).name === "string" &&
        typeof (entry as SavedView).qs === "string",
    );
  } catch {
    return [];
  }
}

function writeViews(resourceName: string, views: SavedView[]): void {
  try {
    localStorage.setItem(storageKey(resourceName), JSON.stringify(views));
  } catch {
    // storage lleno/bloqueado: la vista simplemente no persiste.
  }
}

export function ViewsMenu({
  resourceName,
  basePath,
  params,
}: Readonly<{
  resourceName: string;
  basePath: string;
  // Estado canónico actual (buildListSearchParams) como record serializable.
  params: Readonly<Record<string, string>>;
}>) {
  const router = useRouter();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [views, setViews] = useState<SavedView[]>([]);
  const [name, setName] = useState("");

  const toggle = () => {
    const button = buttonRef.current;
    if (!button) return;
    setAnchor((current) => {
      if (current) return null;
      setViews(readViews(resourceName));
      setName("");
      return measureAnchor(button);
    });
  };

  const currentQs = (): string => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === "offset") continue; // una vista siempre abre en la página 1
      next.set(key, value);
    }
    return next.toString();
  };

  const saveCurrent = () => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    const next = [
      ...views.filter((view) => view.name !== trimmed),
      { name: trimmed, qs: currentQs() },
    ].sort((a, b) => a.name.localeCompare(b.name));
    writeViews(resourceName, next);
    setViews(next);
    setName("");
  };

  const apply = (view: SavedView) => {
    setAnchor(null);
    router.push(view.qs ? `${basePath}?${view.qs}` : basePath);
  };

  const remove = (view: SavedView) => {
    const next = views.filter((entry) => entry.name !== view.name);
    writeViews(resourceName, next);
    setViews(next);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={Boolean(anchor)}
        aria-label="Vistas guardadas"
        title="Vistas guardadas"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--panel)] text-[var(--tx2)] transition hover:border-[var(--accent-bd)] hover:text-[var(--accent-tx)]"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
        </svg>
      </button>
      {anchor ? (
        <FilterPanel
          anchor={anchor}
          title="Vistas guardadas"
          onClose={() => setAnchor(null)}
          ignoreRef={buttonRef}
        >
          <div className="space-y-3">
            {views.length > 0 ? (
              <ul className="space-y-0.5">
                {views.map((view) => (
                  <li key={view.name} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => apply(view)}
                      className="min-w-0 flex-1 truncate rounded-[8px] px-2 py-1.5 text-left text-[13px] text-[var(--tx)] transition hover:bg-[var(--panel2)]"
                    >
                      {view.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(view)}
                      aria-label={`Eliminar vista ${view.name}`}
                      title="Eliminar vista"
                      className="rounded-[7px] p-1 text-[var(--tx3)] transition hover:bg-[var(--panel2)] hover:text-[var(--danger)]"
                    >
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-1 text-[12px] text-[var(--tx3)]">
                Sin vistas guardadas para este recurso.
              </p>
            )}

            <form
              onSubmit={(event) => {
                event.preventDefault();
                saveCurrent();
              }}
              className="flex items-center gap-1.5 border-t border-[var(--border)] pt-3"
            >
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Nombre de la vista"
                aria-label="Nombre de la vista"
                maxLength={60}
                className="min-w-0 flex-1 rounded-[9px] border border-[var(--border2)] bg-[var(--bg2)] px-2.5 py-1.5 text-[13px] text-[var(--tx)] outline-none transition focus:border-[var(--accent-bd)]"
              />
              <button
                type="submit"
                disabled={name.trim() === ""}
                className="rounded-[9px] bg-[var(--accent)] px-2.5 py-1.5 text-[12.5px] font-semibold text-[var(--on-accent)] transition hover:brightness-105 disabled:opacity-50"
              >
                Guardar
              </button>
            </form>
            <p className="px-1 text-[11px] text-[var(--tx3)]">
              Guarda la búsqueda, filtros, orden y límite actuales.
            </p>
          </div>
        </FilterPanel>
      ) : null}
    </>
  );
}
