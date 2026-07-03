import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ApiRequestError } from "@/core/api/api-error";
import { serverApi } from "@/core/api/server-client";

import { parseDriveFiles, type DriveFilesResult } from "./drive-files.ts";
import { parseBackupSettings, type BackupSettings } from "./settings.ts";

// Data layer SERVER-ONLY de la vista de respaldos en Drive: UNA lectura del endpoint
// de listado con la cookie de la sesión. Los 409 del backend (Drive sin conectar o
// que requiere reconexión) se proyectan como estados legibles de la vista, no como
// errores; 401 redirige a login como el resto de la app.

export async function getDriveBackupFiles(): Promise<DriveFilesResult> {
  const cookie = (await cookies()).toString();
  try {
    const payload = await serverApi<unknown>("/api/v1/backups/drive-files", { cookie });
    const parsed = parseDriveFiles(payload);
    if (parsed === null) {
      return { status: "error", message: "La respuesta del servidor no tiene la forma esperada." };
    }
    return { status: "ok", folderId: parsed.folderId, files: parsed.files };
  } catch (error) {
    if (error instanceof ApiRequestError) {
      if (error.status === 401) {
        redirect("/login");
      }
      if (error.status === 409) {
        return error.message.includes("reconecta") || error.message.includes("rechazó")
          ? { status: "needs_reauth" }
          : { status: "not_connected" };
      }
      if (error.status === 403) {
        return { status: "error", message: "No tienes permiso para ver los respaldos." };
      }
      if (error.status === 502) {
        return { status: "error", message: "Google Drive no está disponible en este momento; intenta de nuevo." };
      }
    }
    return { status: "error", message: "No se pudo consultar Google Drive." };
  }
}

/** Fila singleton de configuración (null si el rol no puede verla o falla la carga). */
export async function getBackupSettingsData(): Promise<BackupSettings | null> {
  const cookie = (await cookies()).toString();
  try {
    const payload = await serverApi<{ items?: unknown[] }>(
      "/api/v1/backup-settings",
      { cookie },
    );
    const first = Array.isArray(payload.items) ? payload.items[0] : null;
    if (first === null || first === undefined) return null;
    // El listado no proyecta todos los campos: se lee el detalle completo.
    const parsedRow = parseBackupSettings(first);
    if (parsedRow === null) return null;
    const detail = await serverApi<unknown>(
      `/api/v1/backup-settings/${encodeURIComponent(parsedRow.id)}`,
      { cookie },
    );
    return parseBackupSettings(detail);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      redirect("/login");
    }
    return null;
  }
}
