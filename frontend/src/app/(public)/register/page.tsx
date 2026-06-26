import { redirect } from "next/navigation";

import { AuthLink, PublicAuthShell } from "@/features/auth/PublicAuthShell";
import { RequestTokenForm } from "@/features/auth/RequestTokenForm";
import { getAuthPolicy } from "@/core/auth/policy-client";
import { getSession } from "@/core/auth/session";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (await getSession()) {
    redirect("/");
  }
  const policy = await getAuthPolicy();
  if (!policy.registration_enabled) {
    redirect("/login");
  }

  return (
    <PublicAuthShell
      title="Crear cuenta"
      description="Te enviaremos un token por correo para confirmar tu registro."
      footer={<AuthLink href="/login">Volver a iniciar sesión</AuthLink>}
    >
      <RequestTokenForm mode="register" />
    </PublicAuthShell>
  );
}
