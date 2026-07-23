"use client";

// Marca de la instalación en las páginas públicas de auth: logo (si el
// administrador lo configuró) + nombre. Sin logo, solo el nombre.
// Isla de cliente porque login/verify es una página "use client" y no puede
// alojar un server component async. Para evitar el parpadeo de la marca base,
// la última marca vista se recuerda en sessionStorage.

import { useEffect, useState } from "react";

import { browserApi } from "@/core/api/browser-client";
import { logoPath, type PublicBranding } from "@/core/branding/branding-paths";

const CACHE_KEY = "public_branding";

function readCache(): PublicBranding | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as PublicBranding) : null;
  } catch {
    return null;
  }
}

export function BrandMark() {
  const [branding, setBranding] = useState<PublicBranding | null>(() =>
    typeof window === "undefined" ? null : readCache(),
  );

  useEffect(() => {
    browserApi<PublicBranding>("/api/v1/public/branding")
      .then((data) => {
        setBranding(data);
        try {
          window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
        } catch {
          // sin almacenamiento: solo se pierde el anti-parpadeo
        }
      })
      .catch(() => {
        // backend caído: se queda la marca base — la página jamás se rompe
      });
  }, []);

  const logo = logoPath(branding);

  return (
    <>
      {logo ? (
        <div className="brand-intro-soft">
          {/* eslint-disable-next-line @next/next/no-img-element -- binario dinámico del backend */}
          <img src={logo} alt="" className="h-[84px] w-[84px] object-contain" />
        </div>
      ) : null}
      <h1 className="text-blur-intro mt-5 text-[27px] font-semibold tracking-tight text-[var(--tx)]">
        {branding?.name || "Platform Core"}
      </h1>
    </>
  );
}
