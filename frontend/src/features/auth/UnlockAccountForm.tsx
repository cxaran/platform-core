"use client";

import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/Button";
import { FieldError } from "@/components/ui/FieldError";
import { Input } from "@/components/ui/Input";
import { AuthAlert, AuthLabel, AuthLink } from "@/features/auth/PublicAuthShell";
import { ApiRequestError } from "@/core/api/api-error";
import { mapAuthFieldErrors, type AuthFieldErrors } from "@/core/auth/public-auth";
import { unlockAccount } from "@/core/auth/public-auth-client";

const FIELDS = new Set(["token"]);

/**
 * Canjea el token de desbloqueo que el backend envía por correo cuando la cuenta se
 * bloquea por intentos fallidos. Al desbloquear NO se crea sesión: se invita a volver
 * a iniciar sesión.
 */
export function UnlockAccountForm({ initialToken = "" }: Readonly<{ initialToken?: string }>) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
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
      await unlockAccount(String(data.get("token") ?? "").trim());
      setDone(true);
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        if (caught.status === 400) {
          setGeneral("El token es inválido o expiró. El bloqueo también expira solo: intenta iniciar sesión más tarde.");
        } else {
          const parsed = mapAuthFieldErrors(caught, FIELDS);
          setGeneral(parsed.general);
          setFields(parsed.fields);
        }
      } else {
        setGeneral("No se pudo desbloquear la cuenta.");
      }
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <AuthAlert tone="ok" role="status">
          Tu cuenta fue desbloqueada correctamente.
        </AuthAlert>
        <p className="text-sm text-[var(--tx2)]">
          Ya puedes <AuthLink href="/login">iniciar sesión</AuthLink> de nuevo.
        </p>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      {general ? (
        <AuthAlert tone="danger" role="alert">
          {general}
        </AuthAlert>
      ) : null}
      <div className="space-y-1.5">
        <AuthLabel htmlFor="ua-token">Token de desbloqueo</AuthLabel>
        <Input
          id="ua-token"
          name="token"
          type="text"
          required
          autoComplete="off"
          defaultValue={initialToken}
        />
        <FieldError message={fields.token?.join(" ")} />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Desbloqueando..." : "Desbloquear cuenta"}
      </Button>
    </form>
  );
}
