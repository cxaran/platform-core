"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { FieldError } from "@/components/ui/FieldError";
import { ApiRequestError } from "@/core/api/api-error";
import type { UserProfileRead } from "@/core/api/contracts";
import { updateProfile } from "@/core/auth/account-mutation-client";

type FieldErrors = Record<string, string[]>;

const ALLOWED_FIELDS = new Set(["name", "last_name", "email"]);

function parseErrors(error: ApiRequestError): { general: string | null; fields: FieldErrors } {
  if (error.status === 422 && error.body.errors) {
    const fields: FieldErrors = {};
    let general: string | null = null;
    for (const item of error.body.errors) {
      const field = item.field?.replace(/^body\./, "");
      if (field && ALLOWED_FIELDS.has(field)) {
        fields[field] = [...(fields[field] ?? []), item.message];
      } else {
        general = "Revisa los datos del perfil.";
      }
    }
    return { general, fields };
  }
  if (error.status === 409) {
    return { general: "Ya existe una cuenta con ese correo.", fields: {} };
  }
  return { general: "No se pudo guardar el perfil. Inténtalo nuevamente.", fields: {} };
}

export function AccountProfileForm({ profile }: Readonly<{ profile: UserProfileRead }>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setGeneralError(null);
    setSuccess(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    const payload = {
      name: String(data.get("name") ?? ""),
      last_name: String(data.get("last_name") ?? ""),
      email: String(data.get("email") ?? ""),
    };
    const emailChanged = payload.email !== profile.email;

    try {
      await updateProfile(payload);
      // Cambiar el email rota el token y cierra la sesión: hay que volver a login.
      if (emailChanged) {
        router.replace("/login");
        return;
      }
      setSuccess("Perfil actualizado.");
      router.refresh();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.status === 401) {
          router.replace("/login");
          return;
        }
        const parsed = parseErrors(error);
        setGeneralError(parsed.general);
        setFieldErrors(parsed.fields);
      } else {
        setGeneralError("No se pudo guardar el perfil. Inténtalo nuevamente.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-label="Datos de perfil"
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-6"
    >
      <h2 className="text-lg font-semibold text-slate-900">Datos de perfil</h2>

      {success ? (
        <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}
      {generalError ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {generalError}
        </div>
      ) : null}

      <Field id="account-name" name="name" label="Nombre" defaultValue={profile.name} errors={fieldErrors.name} />
      <Field id="account-last-name" name="last_name" label="Apellido" defaultValue={profile.last_name} errors={fieldErrors.last_name} />
      <Field id="account-email" name="email" type="email" label="Correo" defaultValue={profile.email} errors={fieldErrors.email} help="Cambiar el correo cerrará tu sesión actual." />

      <Button type="submit" disabled={pending}>
        {pending ? "Guardando..." : "Guardar perfil"}
      </Button>
    </form>
  );
}

function Field({
  id,
  name,
  label,
  defaultValue,
  errors,
  type = "text",
  help,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  defaultValue: string;
  errors?: string[];
  type?: "text" | "email";
  help?: string;
}>) {
  const hasErrors = (errors?.length ?? 0) > 0;
  const errorId = hasErrors ? `${id}-error` : undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-slate-900">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required
        aria-required="true"
        aria-invalid={hasErrors || undefined}
        aria-describedby={errorId}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
      />
      {help ? <p className="text-xs text-slate-500">{help}</p> : null}
      <FieldError id={errorId} message={errors?.join(" ")} />
    </div>
  );
}
