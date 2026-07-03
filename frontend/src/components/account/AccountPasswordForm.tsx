"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { FieldError } from "@/components/ui/FieldError";
import { ApiRequestError } from "@/core/api/api-error";
import { changePassword } from "@/core/auth/account-mutation-client";

type FieldErrors = Record<string, string[]>;

const ALLOWED_FIELDS = new Set(["current_password", "password", "confirm_password"]);

function parseErrors(error: ApiRequestError): { general: string | null; fields: FieldErrors } {
  if (error.status === 400 && error.body.code === "invalid_current_password") {
    return { general: null, fields: { current_password: ["La contraseña actual es inválida."] } };
  }
  if (error.status === 422 && error.body.errors) {
    const fields: FieldErrors = {};
    let general: string | null = null;
    for (const item of error.body.errors) {
      const field = item.field?.replace(/^body\./, "");
      if (field && ALLOWED_FIELDS.has(field)) {
        fields[field] = [...(fields[field] ?? []), item.message];
      } else {
        general = "Revisa los datos de la contraseña.";
      }
    }
    return { general, fields };
  }
  return { general: "No se pudo cambiar la contraseña. Inténtalo nuevamente.", fields: {} };
}

export function AccountPasswordForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setGeneralError(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    try {
      await changePassword({
        current_password: String(data.get("current_password") ?? ""),
        password: String(data.get("password") ?? ""),
        confirm_password: String(data.get("confirm_password") ?? ""),
      });
      // Cambiar la contraseña rota el token: la sesión actual queda inválida.
      router.replace("/login");
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
        setGeneralError("No se pudo cambiar la contraseña. Inténtalo nuevamente.");
      }
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-label="Cambiar contraseña"
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-6"
    >
      <h2 className="text-lg font-semibold text-slate-900">Cambiar contraseña</h2>
      <p className="text-sm text-slate-500">Al cambiar la contraseña se cerrará tu sesión actual.</p>

      {generalError ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {generalError}
        </div>
      ) : null}

      <Field id="account-current-password" name="current_password" label="Contraseña actual" errors={fieldErrors.current_password} />
      <Field id="account-new-password" name="password" label="Nueva contraseña" errors={fieldErrors.password} />
      <Field id="account-confirm-password" name="confirm_password" label="Confirmar nueva contraseña" errors={fieldErrors.confirm_password} />

      <Button type="submit" disabled={pending}>
        {pending ? "Cambiando..." : "Cambiar contraseña"}
      </Button>
    </form>
  );
}

function Field({
  id,
  name,
  label,
  errors,
}: Readonly<{ id: string; name: string; label: string; errors?: string[] }>) {
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
        type="password"
        required
        aria-required="true"
        aria-invalid={hasErrors || undefined}
        aria-describedby={errorId}
        autoComplete="new-password"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
      />
      <FieldError id={errorId} message={errors?.join(" ")} />
    </div>
  );
}
