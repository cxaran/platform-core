import { ResourceListView } from "@/components/resources/ResourceListView";
import { requireSession } from "@/core/auth/session";
import { getResourceCapability } from "@/core/resources/capabilities-client";
import {
  getBackupSettingsData,
  getDriveBackupFiles,
} from "@/core/backups/drive-files-data";
import { BackupDriveFilesView } from "@/components/backups/BackupDriveFilesView";
import { BackupSettingsPanel } from "@/components/backups/BackupSettingsPanel";

// Página de RESPALDOS: configuración completa (panel a medida) + archivos reales
// de la carpeta de Drive con descarga y exploración + HISTORIAL de ejecuciones
// (la tabla genérica del recurso backup_runs, incrustada con esta ruta como
// base: filtros/orden/paginación viven en la URL de esta página). El callback
// OAuth regresa aquí (?drive=…).

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BackupsPage({ searchParams }: PageProps) {
  await requireSession();
  const params = await searchParams;
  const driveParam = typeof params.drive === "string" ? params.drive : null;
  const [settings, result, runsCapability] = await Promise.all([
    getBackupSettingsData(),
    getDriveBackupFiles(),
    getResourceCapability("backup_runs"),
  ]);
  return (
    <div className="space-y-8">
      <BackupDriveFilesView
        result={result}
        settingsPanel={
          settings ? (
            <BackupSettingsPanel
              key={settings.id + String(driveParam)}
              initial={settings}
              driveParam={driveParam}
            />
          ) : undefined
        }
      />
      {runsCapability ? (
        <section className="space-y-4">
          <ResourceListView
            capability={runsCapability}
            basePath="/backups"
            rawSearchParams={params}
          />
        </section>
      ) : null}
    </div>
  );
}
