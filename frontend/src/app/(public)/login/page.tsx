import { redirect } from "next/navigation";

import { AuthLink, PublicAuthShell } from "@/features/auth/PublicAuthShell";
import { LoginForm } from "@/features/auth/LoginForm";
import { getAuthPolicy } from "@/core/auth/policy-client";
import { getSession } from "@/core/auth/session";
import { getBootstrapStatus } from "@/core/bootstrap/bootstrap-server";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getSession();
  if (session) {
    redirect("/");
  }

  const status = await getBootstrapStatus();
  if (status.setup_required) {
    redirect("/setup");
  }

  // El frontend no asume signup público: muestra los enlaces solo si el backend
  // publica que el flujo correspondiente está habilitado.
  const policy = await getAuthPolicy();

  return (
    <PublicAuthShell title="Iniciar sesión">
      <LoginForm />
      <div className="mt-6 space-y-2 text-sm text-[var(--tx2)]">
        {policy.password_reset_enabled ? (
          <p>
            <AuthLink href="/forgot-password">¿Olvidaste tu contraseña?</AuthLink>
          </p>
        ) : null}
        {policy.registration_enabled ? (
          <p>
            ¿No tienes cuenta? <AuthLink href="/register">Crear cuenta</AuthLink>
          </p>
        ) : null}
        {/* El desbloqueo no depende de la política: el correo de bloqueo siempre envía token. */}
        <p>
          ¿Cuenta bloqueada? <AuthLink href="/unlock">Desbloquear con token</AuthLink>
        </p>
      </div>
    </PublicAuthShell>
  );
}
