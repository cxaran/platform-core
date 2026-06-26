"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { FieldError } from "@/components/ui/FieldError";
import { ApiRequestError } from "@/core/api/api-error";
import { mapAuthFieldErrors, type AuthFieldErrors } from "@/core/auth/public-auth";
import { resetPassword } from "@/core/auth/public-auth-client";

const FIELDS = new Set(["email", "token", "password", "confirm_password"]);

export function ResetPasswordForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [general, setGeneral] = useState<string | null>(null);
  const [fields, setFields] = useState<AuthFieldErrors>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setGeneral(null);
    setFields({});
    const data = new FormData(event.currentTarget);
    try {
      await resetPassword({
        email: String(data.get("email") ?? ""),
        token: String(data.get("token") ?? ""),
        password: String(data.get("password") ?? ""),
        confirm_password: String(data.get("confirm_password") ?? ""),
      });
      // El reset invalida sesiones previas y no crea sesión automática.
      router.replace("/login");
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        if (caught.status === 400) {
          setGeneral("El token es inválido o expiró. Solicita uno nuevo.");
        } else {
          const parsed = mapAuthFieldErrors(caught, FIELDS);
          setGeneral(parsed.general);
          setFields(parsed.fields);
        }
      } else {
        setGeneral("No se pudo actualizar la contraseña.");
      }
      setPending(false);
    }
  }

  function fieldError(key: string): string | undefined {
    return fields[key]?.join(" ");
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      {general ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {general}
        </div>
      ) : null}
      <Text id="rp-email" name="email" type="email" label="Email" error={fieldError("email")} />
      <Text id="rp-token" name="token" label="Token de recuperación" error={fieldError("token")} />
      <Text id="rp-password" name="password" type="password" label="Nueva contraseña" error={fieldError("password")} />
      <Text id="rp-confirm" name="confirm_password" type="password" label="Confirmar contraseña" error={fieldError("confirm_password")} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Actualizando..." : "Actualizar contraseña"}
      </Button>
    </form>
  );
}

function Text({
  id,
  name,
  label,
  type = "text",
  error,
}: Readonly<{ id: string; name: string; label: string; type?: "text" | "email" | "password"; error?: string }>) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-900">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required
        autoComplete={type === "password" ? "new-password" : "off"}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
      />
      <FieldError message={error} />
    </div>
  );
}
