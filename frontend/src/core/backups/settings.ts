// Módulo PURO de la configuración de respaldos en la página /backups: tipos y
// normalización de la respuesta del backend + textos de estado. Sin fetch ni React.

export type DriveStatus = "disconnected" | "active" | "needs_reauth";

export interface BackupSettings {
  id: string;
  enabled: boolean;
  timezone: string;
  dailyTime: string;
  nextRunAt: string | null;
  filenamePrefix: string;
  retentionDaily: number;
  retentionMonthly: number;
  retentionYearly: number;
  ageRecipient: string | null;
  ageFingerprint: string | null;
  driveStatus: DriveStatus;
  driveConnectedAt: string | null;
  lastErrorCode: string | null;
  lastErrorSummary: string | null;
  lastErrorAt: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Normaliza la fila del backend (snake_case) al tipo de la vista. */
export function parseBackupSettings(payload: unknown): BackupSettings | null {
  if (!isPlainObject(payload) || typeof payload.id !== "string") return null;
  const status = payload.drive_status;
  return {
    id: payload.id,
    enabled: payload.enabled === true,
    timezone: typeof payload.timezone === "string" ? payload.timezone : "UTC",
    dailyTime: typeof payload.daily_time === "string" ? payload.daily_time : "02:00:00",
    nextRunAt: optionalString(payload.next_run_at),
    filenamePrefix:
      typeof payload.filename_prefix === "string" ? payload.filename_prefix : "platform-core",
    retentionDaily: Number(payload.retention_daily_count ?? 7),
    retentionMonthly: Number(payload.retention_monthly_count ?? 12),
    retentionYearly: Number(payload.retention_yearly_count ?? 5),
    ageRecipient: optionalString(payload.age_recipient),
    ageFingerprint: optionalString(payload.age_recipient_fingerprint),
    driveStatus:
      status === "active" || status === "needs_reauth" ? status : "disconnected",
    driveConnectedAt: optionalString(payload.drive_connected_at),
    lastErrorCode: optionalString(payload.last_error_code),
    lastErrorSummary: optionalString(payload.last_error_summary),
    lastErrorAt: optionalString(payload.last_error_at),
  };
}

export const DRIVE_STATUS_TEXT: Record<DriveStatus, { label: string; tone: "ok" | "warn" | "off" }> = {
  active: { label: "Conectado", tone: "ok" },
  needs_reauth: { label: "Requiere reconexión", tone: "warn" },
  disconnected: { label: "Sin conectar", tone: "off" },
};

/** Payload PATCH desde los valores del formulario. El recipient vacío se traduce a
 * null SOLO si antes había uno (borrarlo apaga el cifrado); si nunca hubo, se omite
 * (el backend valida min_length). La hora "HH:MM" del input se envía tal cual. */
export function buildSettingsPatch(
  current: BackupSettings,
  form: {
    enabled: boolean;
    dailyTime: string;
    timezone: string;
    filenamePrefix: string;
    retentionDaily: number;
    retentionMonthly: number;
    retentionYearly: number;
    ageRecipient: string;
  },
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    enabled: form.enabled,
    daily_time: form.dailyTime,
    timezone: form.timezone.trim(),
    filename_prefix: form.filenamePrefix.trim(),
    retention_daily_count: form.retentionDaily,
    retention_monthly_count: form.retentionMonthly,
    retention_yearly_count: form.retentionYearly,
  };
  const recipient = form.ageRecipient.trim();
  if (recipient !== "") {
    if (recipient !== (current.ageRecipient ?? "")) {
      patch.age_recipient = recipient;
    }
  } else if (current.ageRecipient !== null) {
    patch.age_recipient = null;
  }
  return patch;
}

/** "HH:MM:SS" del backend → valor del input time ("HH:MM"). */
export function toTimeInputValue(dailyTime: string): string {
  return dailyTime.slice(0, 5);
}
