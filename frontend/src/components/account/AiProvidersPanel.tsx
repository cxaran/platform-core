"use client";

// Credenciales de proveedor de IA del usuario (para el copiloto). Owner-only: cada
// usuario aporta su propia API key, que se cifra en reposo y NUNCA se vuelve a mostrar.
// El Agent Gateway la arrienda por turno; el navegador no la conserva.

import { FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { ApiRequestError } from "@/core/api/api-error";
import {
  AI_PROVIDER_LABELS,
  createAiCredential,
  deleteAiCredential,
  listAiCredentials,
  updateAiCredential,
  type AiProvider,
  type AiProviderCredential,
} from "@/core/agent/ai-providers-client";

export function AiProvidersPanel() {
  const [credentials, setCredentials] = useState<AiProviderCredential[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listAiCredentials()
      .then((rows) => {
        if (!cancelled) {
          setCredentials(rows);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("No se pudieron cargar las credenciales.");
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const created = await createAiCredential({
        provider: String(data.get("provider") ?? "openai") as AiProvider,
        label: String(data.get("label") ?? ""),
        secret: String(data.get("secret") ?? ""),
        default_model: String(data.get("default_model") ?? "").trim() || null,
      });
      setCredentials((prev) => [...prev, created]);
      setShowForm(false);
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.body.message
          : "No se pudo guardar la credencial.",
      );
    } finally {
      setPending(false);
    }
  }

  async function onToggleActive(credential: AiProviderCredential) {
    setError(null);
    try {
      const updated = await updateAiCredential(credential.id, {
        is_active: !credential.is_active,
      });
      setCredentials((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
    } catch {
      setError("No se pudo actualizar la credencial.");
    }
  }

  async function onDelete(credential: AiProviderCredential) {
    setError(null);
    try {
      await deleteAiCredential(credential.id);
      setCredentials((prev) => prev.filter((row) => row.id !== credential.id));
    } catch {
      setError("No se pudo eliminar la credencial.");
    }
  }

  const providerLabel = (provider: AiProvider): string =>
    AI_PROVIDER_LABELS.find(([value]) => value === provider)?.[1] ?? provider;

  return (
    <section className="rounded-[14px] border border-[var(--border2)] bg-[var(--bg2)] p-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-[var(--tx)]">Proveedores de IA</h2>
          <p className="mt-0.5 text-xs text-[var(--tx3)]">
            Tu API key habilita el copiloto. Se cifra en reposo y no vuelve a mostrarse.
          </p>
        </div>
        {!showForm ? (
          <Button type="button" className="!px-3 !py-2 !text-xs" onClick={() => setShowForm(true)}>
            Agregar
          </Button>
        ) : null}
      </div>

      {error ? <p className="mt-3 text-xs text-red-500">{error}</p> : null}

      {loaded && credentials.length === 0 && !showForm ? (
        <p className="mt-3 text-sm text-[var(--tx3)]">
          Sin credenciales todavía. Agrega una API key para usar el copiloto con un proveedor real.
        </p>
      ) : null}

      <ul className="mt-3 space-y-2">
        {credentials.map((credential) => (
          <li
            key={credential.id}
            className="flex items-center gap-3 rounded-[11px] border border-[var(--border2)] bg-[var(--bg)] px-3 py-2.5 text-sm"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-[var(--tx)]">{credential.label}</p>
              <p className="truncate text-xs text-[var(--tx3)]">
                {providerLabel(credential.provider)}
                {credential.default_model ? ` · ${credential.default_model}` : ""}
                {credential.is_active ? "" : " · inactiva"}
              </p>
            </div>
            <button
              type="button"
              className="rounded-[9px] border border-[var(--border2)] px-2.5 py-1.5 text-xs text-[var(--tx2)] transition hover:border-[var(--accent-bd)]"
              onClick={() => onToggleActive(credential)}
            >
              {credential.is_active ? "Desactivar" : "Activar"}
            </button>
            <button
              type="button"
              className="rounded-[9px] border border-[var(--border2)] px-2.5 py-1.5 text-xs text-[var(--tx2)] transition hover:border-red-400 hover:text-red-500"
              onClick={() => onDelete(credential)}
            >
              Eliminar
            </button>
          </li>
        ))}
      </ul>

      {showForm ? (
        <form className="mt-4 space-y-3" onSubmit={onCreate}>
          <label className="flex flex-col gap-1 text-xs text-[var(--tx2)]">
            Proveedor
            <Select name="provider" defaultValue="openai">
              {AI_PROVIDER_LABELS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--tx2)]">
            Etiqueta
            <Input name="label" required maxLength={120} placeholder="Mi cuenta personal" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--tx2)]">
            API key
            <Input
              name="secret"
              type="password"
              required
              autoComplete="off"
              placeholder="sk-…"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[var(--tx2)]">
            Modelo por defecto (opcional)
            <Input name="default_model" maxLength={160} placeholder="p. ej. gpt-4o-mini" />
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "Guardar credencial"}
            </Button>
            <button
              type="button"
              className="rounded-[11px] border border-[var(--border2)] px-3 py-2 text-sm text-[var(--tx2)]"
              onClick={() => setShowForm(false)}
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
