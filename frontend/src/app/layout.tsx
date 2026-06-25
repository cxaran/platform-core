import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Platform Core",
  description: "Shell base reutilizable para productos Platform Core",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
