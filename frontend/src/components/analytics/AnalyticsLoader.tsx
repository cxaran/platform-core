"use client";

// Carga condicionada de GA4 en el sitio PÚBLICO (nunca en el panel: este
// componente solo se monta en el layout del grupo (public)). Lee la config del
// backend y respeta el consentimiento (ver core/analytics/consent.ts). Ningún
// fallo aquí puede romper la página: sin config, no se carga nada.

import { useEffect, useState } from "react";

import { browserApi } from "@/core/api/browser-client";
import {
  CONSENT_STORAGE_KEY,
  gtagScriptUrl,
  readStoredConsent,
  shouldLoadAnalytics,
  shouldShowConsentBanner,
  type ConsentState,
  type PublicAnalyticsConfig,
} from "@/core/analytics/consent";

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

function loadGtag(config: PublicAnalyticsConfig): void {
  const measurementId = config.measurement_id;
  if (!measurementId || document.querySelector("script[data-analytics-gtag]")) {
    return;
  }
  const script = document.createElement("script");
  script.async = true;
  script.src = gtagScriptUrl(measurementId);
  script.setAttribute("data-analytics-gtag", "true");
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer ?? [];
  function gtag(...args: unknown[]): void {
    window.dataLayer?.push(args);
  }
  gtag("js", new Date());
  gtag("config", measurementId, {
    anonymize_ip: true,
    ...(config.debug_mode ? { debug_mode: true } : {}),
  });
}

export function AnalyticsLoader() {
  const [config, setConfig] = useState<PublicAnalyticsConfig | null>(null);
  // Lectura perezosa: en SSR no hay localStorage y el primer render es null de
  // todos modos (config vacía), así que no hay riesgo de hidratación dispareja.
  const [consent, setConsent] = useState<ConsentState>(() =>
    typeof window === "undefined"
      ? "undecided"
      : readStoredConsent(window.localStorage.getItem(CONSENT_STORAGE_KEY)),
  );

  useEffect(() => {
    browserApi<PublicAnalyticsConfig>("/api/v1/public/site/analytics")
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    if (config && shouldLoadAnalytics(config, consent)) {
      loadGtag(config);
    }
  }, [config, consent]);

  const decide = (value: Extract<ConsentState, "granted" | "denied">) => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, value);
    setConsent(value);
  };

  if (!shouldShowConsentBanner(config, consent)) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-label="Aviso de cookies analíticas"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-200 bg-white/95 p-4 backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          Usamos cookies analíticas (Google Analytics) para entender el uso del
          sitio. No se carga nada hasta que aceptes.
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => decide("denied")}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Rechazar
          </button>
          <button
            type="button"
            onClick={() => decide("granted")}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}
