import type { NextConfig } from "next";

const apiProxyTarget = process.env.API_PROXY_TARGET;

// Orígenes adicionales permitidos por el dev server (p. ej. la IP LAN del host para
// probar desde otro dispositivo en la misma red). CSV en DEV_ALLOWED_ORIGINS; vacío
// por defecto (solo localhost). No afecta a producción.
const devAllowedOrigins = (process.env.DEV_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  output: "standalone",
  ...(devAllowedOrigins.length > 0 ? { allowedDevOrigins: devAllowedOrigins } : {}),
  async rewrites() {
    if (!apiProxyTarget) {
      return [];
    }

    return [
      {
        source: "/api/:path*",
        destination: `${apiProxyTarget}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
