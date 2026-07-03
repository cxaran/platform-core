"use client";

import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/Button";
import { FieldError } from "@/components/ui/FieldError";
import { Input } from "@/components/ui/Input";
import { AuthAlert, AuthLabel, AuthLink } from "@/features/auth/PublicAuthShell";
import { ApiRequestError } from "@/core/api/api-error";
import { publicAuthGeneralError } from "@/core/auth/public-auth";
import { requestPasswordReset, requestRegistration } from "@/core/auth/public-auth-client";

type Mode = "register" | "forgot";

const COPY: Record<
  Mode,
  { button: string; success: string; nextHref: string; nextLabel: string }
> = {
  register: {
    button: "Enviar token de registro",
    success:
      "Si el email puede registrarse, te enviamos un token. Revisa tu correo y continúa.",
    nextHref: "/register/complete",
    nextLabel: "Ya tengo mi token de registro",
  },
  forgot: {
    button: "Enviar token de recuperación",
    success:
      "Si el email tiene una cuenta, te enviamos un token para restablecer la contraseña.",
    nextHref: "/reset-password",
    nextLabel: "Ya tengo mi token de recuperación",
  },
};

/**
 * Formulario de solo email para flujos anti-enumeración (registro y recuperación):
 * la respuesta exitosa es idéntica exista o no la cuenta. El ``mode`` (string) lo
 * pasa el Server Component; la función de mutación se resuelve aquí en el cliente.
 */
export function RequestTokenForm({ mode }: Readonly<{ mode: Mode }>) {
  const copy = COPY[mode];
  const submit = mode === "register" ? requestRegistration : requestPasswordReset;
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    try {
      await submit(email);
      setDone(true);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? publicAuthGeneralError(caught) : null);
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <AuthAlert tone="ok" role="status">
          {copy.success}
        </AuthAlert>
        <p className="text-sm">
          <AuthLink href={copy.nextHref}>{copy.nextLabel}</AuthLink>
        </p>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div className="space-y-1.5">
        <AuthLabel htmlFor="email">Correo electrónico</AuthLabel>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <FieldError message={error} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Enviando..." : copy.button}
      </Button>
    </form>
  );
}
