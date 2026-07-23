// Tipos y URLs de la marca pública — CLIENT-SAFE (sin "server-only"): los usan
// tanto los server components (metadata, manifest) como islas de cliente
// (BrandMark). El fetch server-side vive en public-branding.ts.

export interface PublicBranding {
  name: string;
  description: string | null;
  has_logo: boolean;
  logo_version: string | null;
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

/** URL del logo ORIGINAL (raster verificado) o null sin logo. */
export function logoPath(branding: PublicBranding | null): string | null {
  if (!branding?.has_logo) {
    return null;
  }
  const version = branding.logo_version ?? "";
  return `/api/v1/public/branding/logo?v=${encodeURIComponent(version)}`;
}
