"use client";

// Configuración de respaldos EN la página /backups (pedido explícito: no depender de
// la tabla genérica /resources/backup_settings). Muestra el estado de Drive con sus
// acciones, el formulario editable (PATCH) y la alerta persistente. Los errores del
// backend se muestran con su detail REAL — nunca el genérico "no se pudo completar".

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ApiRequestError } from "@/core/api/api-error";
import {
  buildSettingsPatch,
  toTimeInputValue,
  DRIVE_STATUS_TEXT,
  type BackupSettings,
} from "@/core/backups/settings";
import {
  connectDrive,
  disconnectDrive,
  generateEncryptionKey,
  patchBackupSettings,
  runBackupNow,
} from "@/core/backups/settings-client";

type Banner = { tone: "ok" | "error"; text: string } | null;

function messageOf(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return "Error inesperado.";
}

const inputClass =
  "rounded-[8px] border border-[var(--border2)] bg-[var(--panel2)] px-2 py-1.5 text-sm text-[var(--tx)]";
const labelClass = "flex flex-col gap-1 text-xs text-[var(--tx2)]";
const primaryButton =
  "rounded-[8px] bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-[var(--on-accent)] transition hover:opacity-90 disabled:opacity-50";
const secondaryButton =
  "rounded-[8px] border border-[var(--border2)] bg-[var(--panel2)] px-3 py-2 text-xs font-semibold text-[var(--tx)] transition hover:opacity-90 disabled:opacity-50";

export function BackupSettingsPanel({
  initial,
  driveParam,
}: Readonly<{ initial: BackupSettings; driveParam: string | null }>) {
  const router = useRouter();
  const [settings, setSettings] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(
    driveParam === "connected"
      ? { tone: "ok", text: "Google Drive quedó conectado." }
      : driveParam === "error"
        ? { tone: "error", text: "La conexión con Google Drive no se completó; intenta de nuevo." }
        : null,
  );

  const [form, setForm] = useState(() => ({
    enabled: initial.enabled,
    dailyTime: toTimeInputValue(initial.dailyTime),
    timezone: initial.timezone,
    filenamePrefix: initial.filenamePrefix,
    retentionDaily: initial.retentionDaily,
    retentionMonthly: initial.retentionMonthly,
    retentionYearly: initial.retentionYearly,
    ageRecipient: initial.ageRecipient ?? "",
  }));

  const driveText = DRIVE_STATUS_TEXT[settings.driveStatus];
  const driveTone = useMemo(() => {
    if (driveText.tone === "ok") return "bg-[var(--ok-soft,rgba(48,164,108,0.15))] text-[var(--ok,#2f9e68)]";
    if (driveText.tone === "warn") return "bg-[var(--warn-soft,rgba(245,159,10,0.15))] text-[var(--warn,#b47b12)]";
    return "bg-[var(--panel2)] text-[var(--tx3)]";
  }, [driveText.tone]);

  async function run(action: string, work: () => Promise<Banner>): Promise<void> {
    setBusy(action);
    setBanner(null);
    try {
      const next = await work();
      setBanner(next);
    } catch (error) {
      setBanner({ tone: "error", text: messageOf(error) });
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    run("save", async () => {
      const updated = await patchBackupSettings(
        settings.id,
        buildSettingsPatch(settings, form),
      );
      setSettings(updated);
      setForm((current) => ({ ...current, ageRecipient: updated.ageRecipient ?? "" }));
      return {
        tone: "ok",
        text: "Configuración guardada. Te enviamos un correo con el resumen.",
      };
    });

  const connect = () =>
    run("connect", async () => {
      const url = await connectDrive(settings.id);
      window.location.assign(url);
      return { tone: "ok", text: "Redirigiendo a Google…" };
    });

  const disconnect = () => {
    if (!window.confirm("¿Desconectar Google Drive? Los archivos remotos y el historial se conservan.")) {
      return;
    }
    void run("disconnect", async () => {
      const updated = await disconnectDrive(settings.id);
      setSettings(updated);
      setForm((current) => ({ ...current, enabled: updated.enabled }));
      return { tone: "ok", text: "Google Drive quedó desconectado." };
    });
  };

  const generateKey = () => {
    if (
      !window.confirm(
        "Se generará una clave de cifrado y la clave PRIVADA se enviará a tu correo. Reemplaza cualquier clave anterior. ¿Continuar?",
      )
    ) {
      return;
    }
    void run("key", async () => {
      const updated = await generateEncryptionKey(settings.id);
      setSettings(updated);
      setForm((current) => ({ ...current, ageRecipient: updated.ageRecipient ?? "" }));
      return {
        tone: "ok",
        text: "Clave generada. Revisa tu correo y GUARDA la clave privada: es la única forma de abrir los respaldos cifrados.",
      };
    });
  };

  const runNow = () =>
    run("run-now", async () => {
      await runBackupNow(settings.id);
      router.refresh();
      return {
        tone: "ok",
        text: "Respaldo encolado: se procesa en menos de un minuto. Usa «Actualizar» para ver el archivo.",
      };
    });

  return (
    <section className="flex flex-col gap-4 rounded-[14px] border border-[var(--border2)] bg-[var(--panel)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-[var(--tx)]">Configuración</h2>
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${driveTone}`}>
            Google Drive: {driveText.label}
          </span>
          {settings.nextRunAt && (
            <span className="text-xs text-[var(--tx3)]">
              Próximo respaldo: {new Date(`${settings.nextRunAt}Z`).toLocaleString("es-MX")}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {settings.driveStatus !== "active" ? (
            <button type="button" onClick={connect} disabled={busy !== null} className={primaryButton}>
              {settings.driveStatus === "needs_reauth" ? "Reconectar Google Drive" : "Conectar Google Drive"}
            </button>
          ) : (
            <>
              <button type="button" onClick={runNow} disabled={busy !== null} className={primaryButton}>
                {busy === "run-now" ? "Encolando…" : "Respaldar ahora"}
              </button>
              <button type="button" onClick={disconnect} disabled={busy !== null} className={secondaryButton}>
                Desconectar
              </button>
            </>
          )}
          <button type="button" onClick={generateKey} disabled={busy !== null} className={secondaryButton}>
            Generar clave de cifrado
          </button>
        </div>
      </div>

      {banner && (
        <p
          className={`rounded-[8px] px-3 py-2 text-sm ${
            banner.tone === "ok"
              ? "bg-[var(--ok-soft,rgba(48,164,108,0.12))] text-[var(--ok,#2f9e68)]"
              : "bg-[var(--danger-soft,rgba(229,72,77,0.12))] text-[var(--danger,#e5484d)]"
          }`}
        >
          {banner.text}
        </p>
      )}

      {settings.lastErrorSummary && (
        <p className="rounded-[8px] bg-[var(--warn-soft,rgba(245,159,10,0.12))] px-3 py-2 text-sm text-[var(--warn,#b47b12)]">
          Última alerta ({settings.lastErrorCode}): {settings.lastErrorSummary}
        </p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        className="flex flex-col gap-3"
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <label className={`${labelClass} justify-end`}>
            <span className="flex items-center gap-2 pb-1.5 text-sm text-[var(--tx)]">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              Respaldo diario
            </span>
          </label>
          <label className={labelClass}>
            Hora local
            <input
              type="time"
              value={form.dailyTime}
              onChange={(event) => setForm({ ...form, dailyTime: event.target.value })}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Zona horaria (IANA)
            <input
              type="text"
              value={form.timezone}
              onChange={(event) => setForm({ ...form, timezone: event.target.value })}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Copias diarias
            <input
              type="number"
              min={0}
              max={365}
              value={form.retentionDaily}
              onChange={(event) => setForm({ ...form, retentionDaily: Number(event.target.value) })}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Copias mensuales
            <input
              type="number"
              min={0}
              max={120}
              value={form.retentionMonthly}
              onChange={(event) => setForm({ ...form, retentionMonthly: Number(event.target.value) })}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Copias anuales
            <input
              type="number"
              min={0}
              max={50}
              value={form.retentionYearly}
              onChange={(event) => setForm({ ...form, retentionYearly: Number(event.target.value) })}
              className={inputClass}
            />
          </label>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <label className={labelClass}>
            Prefijo del archivo
            <input
              type="text"
              value={form.filenamePrefix}
              onChange={(event) => setForm({ ...form, filenamePrefix: event.target.value })}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Cifrado (clave pública age, opcional{settings.ageFingerprint ? ` — huella ${settings.ageFingerprint}` : ""})
            <input
              type="text"
              value={form.ageRecipient}
              onChange={(event) => setForm({ ...form, ageRecipient: event.target.value })}
              placeholder="Vacío = respaldos sin cifrar"
              autoComplete="off"
              spellCheck={false}
              className={`${inputClass} font-mono text-xs`}
            />
          </label>
        </div>
        <div>
          <button type="submit" disabled={busy !== null} className={primaryButton}>
            {busy === "save" ? "Guardando…" : "Guardar configuración"}
          </button>
        </div>
      </form>
    </section>
  );
}
