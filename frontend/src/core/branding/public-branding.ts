import "server-only";

// Marca PÚBLICA de la instalación para el manifest de la PWA (server-side, sin
// cookie). Cualquier fallo (backend caído, timeout) devuelve null: el manifest
// cae a la identidad estática — obtener la marca JAMÁS puede ser punto de fallo.

export interface PublicBranding {
  name: string;
  has_logo: boolean;
  logo_version: string | null;
}

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

/**
 * URL del ícono CUADRADO de la PWA (logo centrado, generado al vuelo por el
 * backend) o null sin logo → el llamador cae al placeholder. ``v`` refresca la
 * caché del navegador cuando el logo cambia.
 */
export function squareIconPath(
  branding: PublicBranding | null,
  size: number,
  opts?: { bg?: string; padding?: number },
): string | null {
  if (!branding?.has_logo) {
    return null;
  }
  const params = new URLSearchParams({ size: String(size) });
  if (branding.logo_version) params.set("v", branding.logo_version);
  if (opts?.bg) params.set("bg", opts.bg);
  if (opts?.padding != null) params.set("padding", String(opts.padding));
  return `/api/v1/public/branding/pwa-icon?${params.toString()}`;
}
