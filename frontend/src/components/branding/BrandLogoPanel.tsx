"use client";

// Logo de la instalación (marca de la PWA). Sube/reemplaza/quita el logo que el
// manifest usa como ícono al instalar la app. Solo imágenes raster (PNG/JPEG/WEBP):
// el backend verifica el CONTENIDO con Pillow (SVG bloqueado por diseño).

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { ApiRequestError } from "@/core/api/api-error";
import { browserApi } from "@/core/api/browser-client";

interface SettingsRow {
  id: string;
  brand_logo_configured: boolean;
  brand_logo_updated_at: string | null;
  institution_name: string | null;
}

interface SettingsPage {
  items: SettingsRow[];
}

export function BrandLogoPanel() {
  const [row, setRow] = useState<SettingsRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void browserApi<SettingsPage>("/api/v1/system-settings?limit=1", { method: "GET" })
      .then((page) => {
        if (!cancelled) setRow(page.items[0] ?? null);
      })
      .catch(() => {
        if (!cancelled) setError("No se pudo cargar la configuración.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onUpload() {
    const file = fileRef.current?.files?.[0];
    if (!row || !file || pending) return;
    setPending(true);
    setError(null);
    const body = new FormData();
    body.append("file", file);
    try {
      const updated = await browserApi<SettingsRow>(
        `/api/v1/system-settings/${row.id}/logo`,
        { method: "PUT", body },
      );
      setRow(updated);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.body.message : "No se pudo subir el logo.",
      );
    } finally {
      setPending(false);
    }
  }

  async function onRemove() {
    if (!row || pending) return;
    setPending(true);
    setError(null);
    try {
      const updated = await browserApi<SettingsRow>(
        `/api/v1/system-settings/${row.id}/logo`,
        { method: "DELETE" },
      );
      setRow(updated);
    } catch {
      setError("No se pudo quitar el logo.");
    } finally {
      setPending(false);
    }
  }

  const logoUrl = row?.brand_logo_configured
    ? `/api/v1/public/branding/logo?v=${encodeURIComponent(row.brand_logo_updated_at ?? "")}`
    : null;
  const iconPreview = row?.brand_logo_configured
    ? `/api/v1/public/branding/pwa-icon?size=192&v=${encodeURIComponent(row.brand_logo_updated_at ?? "")}`
    : "/icons/icon-192.png";

  return (
    <section className="rounded-[14px] border border-[var(--border2)] bg-[var(--bg2)] p-5">
      <h2 className="text-base font-semibold text-[var(--tx)]">Logo de la instalación</h2>
      <p className="mt-0.5 text-xs text-[var(--tx3)]">
        Identidad de la app instalable (PWA): el manifest usa este logo como ícono. Solo
        PNG, JPEG o WEBP (máx. 2 MB); sin logo se usan los íconos genéricos.
      </p>

      {error ? <p className="mt-3 text-xs text-red-500">{error}</p> : null}

      <div className="mt-4 flex items-center gap-4">
        {/* Vista previa del ícono cuadrado EXACTO que verá el instalador. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={iconPreview}
          alt="Ícono actual de la PWA"
          width={72}
          height={72}
          className="h-18 w-18 rounded-[14px] border border-[var(--border2)] bg-[var(--bg)] object-contain p-1"
        />
        <div className="flex min-w-0 flex-col gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="text-xs text-[var(--tx2)] file:mr-3 file:rounded-[9px] file:border file:border-[var(--border2)] file:bg-[var(--bg)] file:px-3 file:py-1.5 file:text-xs file:text-[var(--tx2)]"
            disabled={pending || !row}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              className="!px-3 !py-1.5 !text-xs"
              disabled={pending || !row}
              onClick={onUpload}
            >
              {pending ? "Guardando…" : row?.brand_logo_configured ? "Reemplazar logo" : "Subir logo"}
            </Button>
            {row?.brand_logo_configured ? (
              <button
                type="button"
                className="rounded-[9px] border border-[var(--border2)] px-3 py-1.5 text-xs text-[var(--tx2)] transition hover:border-red-400 hover:text-red-500"
                disabled={pending}
                onClick={onRemove}
              >
                Quitar logo
              </button>
            ) : null}
          </div>
          {logoUrl ? (
            <p className="truncate text-[10px] text-[var(--tx3)]">
              Logo activo · el manifest se actualiza al instante.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
