import type { MetadataRoute } from "next";

import { getPublicBranding, squareIconPath } from "@/core/branding/public-branding";

// Manifest de la PWA: hace la app INSTALABLE (requisito duro de iOS para Web
// Push: solo la app añadida a la pantalla de inicio recibe avisos) y le da su
// identidad al instalarla con la MARCA REAL de la instalación:
//
// - Nombre: `institution_name` (editable en Configuración del sistema) vía
//   `GET /public/branding`; fallback a la marca base del despliegue.
// - Íconos: el LOGO de la instalación CUADRADO (centrado, márgenes
//   transparentes, generado al vuelo por /public/branding/pwa-icon; solo raster
//   verificado, SVG bloqueado). Sin logo, íconos placeholder estáticos. El
//   maskable usa el logo sobre fondo blanco con padding de zona segura.
// - Colores: neutros de la base (un producto derivado puede tomar los suyos).
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const branding = await getPublicBranding();
  const name = branding?.name || "Platform Core";

  const icon192 = squareIconPath(branding, 192);
  const icon512 = squareIconPath(branding, 512);
  const maskable = squareIconPath(branding, 512, { bg: "ffffff", padding: 0.14 });
  const icons: MetadataRoute.Manifest["icons"] =
    icon192 && icon512 && maskable
      ? [
          { src: icon192, sizes: "192x192", type: "image/png", purpose: "any" },
          { src: icon512, sizes: "512x512", type: "image/png", purpose: "any" },
          { src: maskable, sizes: "512x512", type: "image/png", purpose: "maskable" },
        ]
      : [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ];

  return {
    name,
    short_name: name.length > 24 ? name.slice(0, 24) : name,
    description: "Plataforma base",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#111111",
    icons,
  };
}
