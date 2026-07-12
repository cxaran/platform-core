import { BrandLogoPanel } from "@/components/branding/BrandLogoPanel";
import { requireSession } from "@/core/auth/session";

// Marca de la instalación: logo de la PWA (manifest). El nombre visible se edita
// en Configuración del sistema (institution_name); aquí vive lo que el formulario
// genérico no puede capturar (archivo binario).

export const dynamic = "force-dynamic";

export default async function BrandingPage() {
  await requireSession();
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--tx)]">Marca</h1>
        <p className="mt-1 text-sm text-[var(--tx3)]">
          Identidad de la app instalable. El nombre se configura en Configuración del
          sistema; aquí, el logo.
        </p>
      </div>
      <BrandLogoPanel />
    </div>
  );
}
