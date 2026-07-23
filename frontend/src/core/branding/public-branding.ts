import "server-only";

// Marca PÚBLICA de la instalación para el manifest de la PWA (server-side, sin
// cookie). Cualquier fallo (backend caído, timeout) devuelve null: el manifest
// cae a la identidad estática — obtener la marca JAMÁS puede ser punto de fallo.

export type { PublicBranding } from "./branding-paths";
export { logoPath, squareIconPath } from "./branding-paths";

import type { PublicBranding } from "./branding-paths";

function backendBase(): string {
  return process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000";
}

export async function getPublicBranding(): Promise<PublicBranding | null> {
  try {
    const response = await fetch(new URL("/api/v1/public/branding", backendBase()), {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as PublicBranding;
  } catch {
    return null;
  }
}
