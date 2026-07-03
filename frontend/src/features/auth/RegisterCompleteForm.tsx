"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { FieldError } from "@/components/ui/FieldError";
import { Input } from "@/components/ui/Input";
import { AuthAlert, AuthLabel } from "@/features/auth/PublicAuthShell";
import { ApiRequestError } from "@/core/api/api-error";
import { mapAuthFieldErrors, type AuthFieldErrors } from "@/core/auth/public-auth";
import { completeRegistration } from "@/core/auth/public-auth-client";

const FIELDS = new Set([
  "name",
  "first_name",
  "last_name",
  "email",
  "token",
  "password",
  "confirm_password",
]);

export function RegisterCompleteForm() {
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
      await completeRegistration({
        first_name: String(data.get("first_name") ?? ""),
        last_name: String(data.get("last_name") ?? ""),
        email: String(data.get("email") ?? ""),
        token: String(data.get("token") ?? ""),
        password: String(data.get("password") ?? ""),
        confirm_password: String(data.get("confirm_password") ?? ""),
      });
      // Sin sesión automática: el usuario inicia sesión normalmente.
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
        setGeneral("No se pudo completar el registro.");
      }
      setPending(false);
    }
  }

  function fieldError(...keys: string[]): string | undefined {
    for (const key of keys) {
      if (fields[key]) return fields[key].join(" ");
    }
    return undefined;
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      {general ? (
        <AuthAlert tone="danger" role="alert">
          {general}
        </AuthAlert>
      ) : null}
      <Text id="rc-first-name" name="first_name" label="Nombre" error={fieldError("first_name", "name")} />
      <Text id="rc-last-name" name="last_name" label="Apellido" error={fieldError("last_name")} />
      <Text id="rc-email" name="email" type="email" label="Email" error={fieldError("email")} />
      <Text id="rc-token" name="token" label="Token de registro" error={fieldError("token")} />
      <Text id="rc-password" name="password" type="password" label="Contraseña" error={fieldError("password")} />
      <Text id="rc-confirm" name="confirm_password" type="password" label="Confirmar contraseña" error={fieldError("confirm_password")} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creando cuenta..." : "Crear cuenta"}
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
    <div className="space-y-1.5">
      <AuthLabel htmlFor={id}>{label}</AuthLabel>
      <Input
        id={id}
        name={name}
        type={type}
        required
        autoComplete={type === "password" ? "new-password" : "off"}
      />
      <FieldError message={error} />
    </div>
  );
}
