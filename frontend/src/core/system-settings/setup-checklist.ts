// Módulo PURO del checklist de puesta en marcha: tipos, normalización de la
// respuesta y el destino de cada ítem. El estado es DERIVADO por el backend; el
// frontend solo lo presenta y enruta. Sin fetch, sin React.

export type ChecklistStatus = "complete" | "pending" | "not_applicable";

export interface ChecklistItem {
  key: string;
  title: string;
  status: ChecklistStatus;
  detail: string;
}

export interface SetupChecklist {
  items: ChecklistItem[];
  dismissed: boolean;
  pendingCount: number;
  environment: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSetupChecklist(payload: unknown): SetupChecklist | null {
  if (!isPlainObject(payload) || !Array.isArray(payload.items)) return null;
  const items: ChecklistItem[] = [];
  for (const entry of payload.items) {
    if (!isPlainObject(entry)) continue;
    if (typeof entry.key !== "string" || typeof entry.title !== "string") continue;
    const status = entry.status;
    if (status !== "complete" && status !== "pending" && status !== "not_applicable") continue;
    items.push({
      key: entry.key,
      title: entry.title,
      status,
      detail: typeof entry.detail === "string" ? entry.detail : "",
    });
  }
  return {
    items,
    dismissed: payload.dismissed === true,
    pendingCount: typeof payload.pending_count === "number" ? payload.pending_count : 0,
    environment: typeof payload.environment === "string" ? payload.environment : "local",
  };
}

/** Destino de "configurar" por ítem (rutas existentes de la app). */
const ITEM_ROUTES: Record<string, string> = {
  institution: "/resources/system_settings",
  registration: "/resources/system_settings",
  domain: "/resources/system_settings",
  email: "/resources/system_settings",
  backups: "/backups",
};

export function itemRoute(key: string): string {
  return ITEM_ROUTES[key] ?? "/resources/system_settings";
}

/** ¿Debe mostrarse el banner? Sólo con pendientes reales y sin descarte previo. */
export function shouldShowBanner(checklist: SetupChecklist | null): boolean {
  return checklist !== null && !checklist.dismissed && checklist.pendingCount > 0;
}
