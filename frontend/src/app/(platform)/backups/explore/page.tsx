import { requireSession } from "@/core/auth/session";
import { ExplorerView } from "@/components/backups/ExplorerView";

// Visor del artefacto de EXPLORACIÓN (fase 2 del explorador de respaldos). El server
// component sólo valida la sesión y pasa file id + nombre; TODO el trabajo (descarga
// vía el endpoint existente, descifrado age local si aplica, SQLite WASM) ocurre en
// el navegador — el backend no gana superficie nueva para esto.

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function BackupExplorePage({ searchParams }: PageProps) {
  await requireSession();
  const params = await searchParams;
  const fileId = single(params.file) ?? "";
  const fileName = single(params.name) ?? "archivo";
  if (!fileId) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-6 text-sm text-[var(--tx2)]">
        Falta el archivo a explorar. Vuelve a la lista de respaldos.
      </div>
    );
  }
  return <ExplorerView fileId={fileId} fileName={fileName} />;
}
