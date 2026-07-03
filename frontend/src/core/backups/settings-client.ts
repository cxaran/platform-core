"use client";

// Mutaciones de la configuración de respaldos desde la página /backups. Reutiliza el
// request layer del navegador (mismo origen, cookie de sesión); los errores llegan
// como ApiRequestError con el detail REAL del backend — la vista lo muestra tal
// cual en lugar del genérico "no se pudo completar la acción".

import { browserApi } from "@/core/api/browser-client";

import { parseBackupSettings, type BackupSettings } from "./settings";

function settingsPath(id: string, suffix = ""): string {
  return `/api/v1/backup-settings/${encodeURIComponent(id)}${suffix}`;
}

async function asSettings(payload: unknown): Promise<BackupSettings> {
  const parsed = parseBackupSettings(payload);
  if (parsed === null) {
    throw new Error("La respuesta del servidor no tiene la forma esperada.");
  }
  return parsed;
}

export function patchBackupSettings(
  id: string,
  patch: Record<string, unknown>,
): Promise<BackupSettings> {
  return browserApi<unknown>(settingsPath(id), { method: "PATCH", body: patch }).then(
    asSettings,
  );
}

export async function connectDrive(id: string): Promise<string> {
  const response = await browserApi<{ authorization_url?: unknown }>(
    settingsPath(id, "/connect-drive"),
    { method: "POST" },
  );
  if (typeof response.authorization_url !== "string") {
    throw new Error("El servidor no devolvió la URL de autorización de Google.");
  }
  return response.authorization_url;
}

export function disconnectDrive(id: string): Promise<BackupSettings> {
  return browserApi<unknown>(settingsPath(id, "/disconnect-drive"), {
    method: "POST",
  }).then(asSettings);
}

export function generateEncryptionKey(id: string): Promise<BackupSettings> {
  return browserApi<unknown>(settingsPath(id, "/generate-encryption-key"), {
    method: "POST",
  }).then(asSettings);
}

export async function runBackupNow(id: string): Promise<void> {
  await browserApi<unknown>(settingsPath(id, "/run-now"), { method: "POST" });
}
