// Lógica pura del consentimiento de analítica (GA4) del sitio público.
//
// La configuración la publica el backend en GET /api/v1/public/site/analytics
// (editable por el administrador en Configuración del sistema). Reglas:
// - apagada: no se carga ningún script ni se pregunta nada;
// - encendida con `require_consent`: nada se carga hasta que el visitante acepte
//   (la decisión se recuerda en localStorage; es preferencia, no autenticación);
// - encendida sin `require_consent`: se carga directo (instalaciones fuera de
//   marcos que exigen consentimiento previo).
// El panel de administración nunca se mide: el loader solo se monta en el
// layout del grupo de rutas públicas.

export type PublicAnalyticsConfig = {
  enabled: boolean;
  measurement_id?: string | null;
  require_consent?: boolean;
  debug_mode?: boolean;
};

export type ConsentState = "granted" | "denied" | "undecided";

export const CONSENT_STORAGE_KEY = "analytics_consent";

export function readStoredConsent(raw: string | null): ConsentState {
  if (raw === "granted" || raw === "denied") {
    return raw;
  }
  return "undecided";
}

export function shouldLoadAnalytics(
  config: PublicAnalyticsConfig | null,
  consent: ConsentState,
): boolean {
  if (!config?.enabled || !config.measurement_id) {
    return false;
  }
  if (config.require_consent === false) {
    return true;
  }
  return consent === "granted";
}

export function shouldShowConsentBanner(
  config: PublicAnalyticsConfig | null,
  consent: ConsentState,
): boolean {
  if (!config?.enabled || !config.measurement_id) {
    return false;
  }
  return config.require_consent !== false && consent === "undecided";
}

export function gtagScriptUrl(measurementId: string): string {
  return `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
}
