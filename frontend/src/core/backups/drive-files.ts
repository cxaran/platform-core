// Módulo PURO de la vista de respaldos en Google Drive (fase inicial del explorador:
// listar archivos reales y descargarlos; sin exploración todavía). Sin fetch, sin
// React: tipos, validación de forma y formateo determinista — testeable con node:test.

export type DriveArtifactKind = "restore" | "explorer";

export interface DriveBackupFile {
  fileId: string;
  name: string;
  sizeBytes: number | null;
  createdTime: string | null;
  artifactKind: DriveArtifactKind;
  backupRunId: string | null;
}

export type DriveFilesResult =
  | { status: "ok"; folderId: string; files: DriveBackupFile[] }
  | { status: "not_connected" }
  | { status: "needs_reauth" }
  | { status: "error"; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Normaliza la respuesta del backend a filas tipadas; descarta entradas malformadas. */
export function parseDriveFiles(payload: unknown): { folderId: string; files: DriveBackupFile[] } | null {
  if (!isPlainObject(payload) || typeof payload.folder_id !== "string" || !Array.isArray(payload.files)) {
    return null;
  }
  const files: DriveBackupFile[] = [];
  for (const entry of payload.files) {
    if (!isPlainObject(entry)) continue;
    if (typeof entry.file_id !== "string" || typeof entry.name !== "string") continue;
    files.push({
      fileId: entry.file_id,
      name: entry.name,
      sizeBytes: typeof entry.size_bytes === "number" ? entry.size_bytes : null,
      createdTime: typeof entry.created_time === "string" ? entry.created_time : null,
      artifactKind: entry.artifact_kind === "explorer" ? "explorer" : "restore",
      backupRunId: typeof entry.backup_run_id === "string" ? entry.backup_run_id : null,
    });
  }
  return { folderId: payload.folder_id, files };
}

/** Ruta de descarga (mismo origen; la cookie de sesión viaja sola). */
export function downloadHref(fileId: string): string {
  return `/api/v1/backups/drive-files/${encodeURIComponent(fileId)}/download`;
}

const KIND_LABELS: Record<DriveArtifactKind, string> = {
  restore: "Respaldo",
  explorer: "Exploración",
};

export function artifactKindLabel(kind: DriveArtifactKind): string {
  return KIND_LABELS[kind];
}

/** Tamaño legible en unidades binarias cortas (es-MX). */
export function formatBytes(size: number | null): string {
  if (size === null || !Number.isFinite(size) || size < 0) return "—";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size;
  let unit = "B";
  for (const next of units) {
    if (value < 1024) break;
    value = value / 1024;
    unit = next;
  }
  const rounded = value >= 100 ? Math.round(value).toString() : value.toFixed(1);
  return `${rounded} ${unit}`;
}

/** Fecha RFC3339 de Drive → fecha/hora regional legible; "—" si falta o es inválida. */
export function formatCreatedTime(iso: string | null, timeZone?: string): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(parsed);
}
