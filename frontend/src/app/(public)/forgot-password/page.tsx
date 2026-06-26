import { redirect } from "next/navigation";

import { AuthLink, PublicAuthShell } from "@/features/auth/PublicAuthShell";
import { RequestTokenForm } from "@/features/auth/RequestTokenForm";
import { getAuthPolicy } from "@/core/auth/policy-client";
import { getSession } from "@/core/auth/session";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  if (await getSession()) {
    redirect("/");
  }
  const policy = await getAuthPolicy();
  if (!policy.password_reset_enabled) {
    redirect("/login");
  }

  return (
    <PublicAuthShell
      title="Recuperar contraseña"
      description="Te enviaremos un token por correo para restablecer tu contraseña."
      footer={<AuthLink href="/login">Volver a iniciar sesión</AuthLink>}
    >
      <RequestTokenForm mode="forgot" />
    </PublicAuthShell>
  );
}
