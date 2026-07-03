"use client";

import { useEffect, useSyncExternalStore } from "react";

export const THEME_STORAGE_KEY = "mp-theme";
// Un año. La cookie deja al servidor fijar ``data-theme`` en SSR (no-flash sin script cliente).
const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

type Theme = "light" | "dark";

// Store externo minimo sobre el atributo data-theme del <html>. Permite leer el
// tema con useSyncExternalStore (compatible con SSR/hidratacion, sin setState en
// effect) y notificar al alternarlo.
const listeners = new Set<() => void>();

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function getServerSnapshot(): Theme {
  return "light";
}

function setTheme(next: Theme): void {
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Si localStorage no esta disponible, el cambio aplica solo para esta sesion.
  }
  // Cookie: la lee el layout del servidor para fijar ``data-theme`` en SSR (no-flash).
  document.cookie = `${THEME_STORAGE_KEY}=${next}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
  listeners.forEach((listener) => listener());
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.5 6.5 0 0 0 9.8 9.8z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

/**
 * Alterna el tema (data-theme en <html>) entre light y dark y persiste la elección en cookie +
 * localStorage. El no-parpadeo lo da el SERVIDOR: el root layout lee la cookie ``mp-theme`` y fija
 * ``data-theme`` en SSR (sin script cliente, que React 19 rechaza). Aquí sólo se refleja el icono y
 * se migra a los usuarios previos que sólo tenían localStorage.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Migración/sincronización: si hay una preferencia en localStorage distinta del ``data-theme`` que
  // el servidor fijó desde la cookie (usuarios previos sin cookie), se aplica y se escribe la cookie
  // para que las cargas siguientes ya salgan correctas desde SSR.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if ((stored === "dark" || stored === "light") && stored !== getSnapshot()) {
        setTheme(stored);
      }
    } catch {
      // localStorage no disponible: sin migración.
    }
  }, []);

  return (
    <button
      type="button"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label={theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      title="Cambiar tema"
      className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--panel)] text-[var(--tx2)] transition hover:bg-[var(--panel2)] hover:text-[var(--tx)]"
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
