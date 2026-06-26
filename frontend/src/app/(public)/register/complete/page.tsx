import { redirect } from "next/navigation";

import { AuthLink, PublicAuthShell } from "@/features/auth/PublicAuthShell";
import { RegisterCompleteForm } from "@/features/auth/RegisterCompleteForm";
import { getAuthPolicy } from "@/core/auth/policy-client";
import { getSession } from "@/core/auth/session";

export const dynamic = "force-dynamic";

export default async function RegisterCompletePage() {
  if (await getSession()) {
    redirect("/");
  }
  const policy = await getAuthPolicy();
  if (!policy.registration_enabled) {
    redirect("/login");
  }

  return (
    <PublicAuthShell
      title="Confirmar registro"
      description="Ingresa el token que recibiste por correo y crea tu contraseña."
      footer={<AuthLink href="/login">Volver a iniciar sesión</AuthLink>}
    >
      <RegisterCompleteForm />
    </PublicAuthShell>
  );
}
