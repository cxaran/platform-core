import type { Metadata } from "next";

import { getPublicBranding, squareIconPath } from "@/core/branding/public-branding";

import "./globals.css";

// Metadata del sitio derivada de la MARCA REAL de la instalación (editable en
// Configuración del sistema): título, descripción y favicon/apple-touch-icon
// desde el logo (cuadrado con márgenes transparentes, generado por el backend).
// Cualquier fallo cae a la identidad estática: la metadata jamás rompe la página.
export async function generateMetadata(): Promise<Metadata> {
  const branding = await getPublicBranding();
  const name = branding?.name || "Platform Core";
  const favicon = squareIconPath(branding, 64);
  // Apple exige ícono opaco: fondo blanco con padding de zona segura.
  const appleIcon = squareIconPath(branding, 180, { bg: "ffffff", padding: 0.1 });

  return {
    title: name,
    description: branding?.description || "Plataforma base",
    icons: {
      icon: favicon ? [{ url: favicon, type: "image/png" }] : "/icons/icon-192.png",
      apple: appleIcon ?? "/icons/icon-192.png",
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
