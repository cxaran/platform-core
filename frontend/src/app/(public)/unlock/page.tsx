import { redirect } from "next/navigation";

import { AuthLink, PublicAuthShell } from "@/features/auth/PublicAuthShell";
import { UnlockAccountForm } from "@/features/auth/UnlockAccountForm";
import { getSession } from "@/core/auth/session";

export const dynamic = "force-dynamic";

/**
 * Desbloqueo de cuenta bloqueada por intentos fallidos. Siempre disponible (no depende
 * de la política de registro/recuperación): el correo de bloqueo envía el token y esta
 * página es donde se canjea. Acepta ``?token=`` para prellenar el campo.
 */
export default async function UnlockAccountPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ token?: string }> }>) {
  if (await getSession()) {
    redirect("/");
  }
  const { token } = await searchParams;

  return (
    <PublicAuthShell
      title="Desbloquear cuenta"
      description="Tu cuenta se bloquea temporalmente tras varios intentos fallidos. Ingresa el token que recibiste por correo para desbloquearla de inmediato."
      footer={<AuthLink href="/login">Volver a iniciar sesión</AuthLink>}
    >
      <UnlockAccountForm initialToken={token ?? ""} />
    </PublicAuthShell>
  );
}
