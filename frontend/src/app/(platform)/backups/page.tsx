import { requireSession } from "@/core/auth/session";
import {
  getBackupSettingsData,
  getDriveBackupFiles,
} from "@/core/backups/drive-files-data";
import { BackupDriveFilesView } from "@/components/backups/BackupDriveFilesView";
import { BackupSettingsPanel } from "@/components/backups/BackupSettingsPanel";

// Página de RESPALDOS: configuración completa (panel a medida; ya no se depende de
// la tabla genérica /resources/backup_settings) + archivos reales de la carpeta de
// Drive con descarga y exploración. El callback OAuth regresa aquí (?drive=…).

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function BackupsPage({ searchParams }: PageProps) {
  await requireSession();
  const params = await searchParams;
  const driveParam = typeof params.drive === "string" ? params.drive : null;
  const [settings, result] = await Promise.all([
    getBackupSettingsData(),
    getDriveBackupFiles(),
  ]);
  return (
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
  );
}
