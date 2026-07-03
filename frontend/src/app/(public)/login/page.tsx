import { redirect } from "next/navigation";

import { AuthAlert, AuthLink, PublicAuthShell } from "@/features/auth/PublicAuthShell";
import { LoginForm } from "@/features/auth/LoginForm";
import { getAuthPolicy } from "@/core/auth/policy-client";
import { getSession } from "@/core/auth/session";
import { getBootstrapStatus } from "@/core/bootstrap/bootstrap-server";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ error?: string }> }>) {
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
  // Marcador genérico del callback de Google (la causa real queda en los logs).
  const { error } = await searchParams;

  return (
    <PublicAuthShell title="Iniciar sesión">
      {error === "google" ? (
        <div className="mb-4">
          <AuthAlert tone="danger">
            No se pudo iniciar sesión con Google. Intenta de nuevo o entra con tu
            contraseña.
          </AuthAlert>
        </div>
      ) : null}
      <LoginForm />
      {policy.google_login_enabled ? (
        <>
          <div className="my-4 flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-[var(--border2)]" />
            <span className="text-xs text-[var(--tx3)]">o</span>
            <span className="h-px flex-1 bg-[var(--border2)]" />
          </div>
          {/* Navegación completa (no fetch): el backend responde 302 a Google. */}
          <a
            href="/api/v1/auth/google/start"
            className="flex w-full items-center justify-center gap-2.5 rounded-[13px] border border-[var(--border2)] bg-[var(--bg2)] px-4 py-2.5 text-sm font-medium text-[var(--tx)] transition hover:border-[var(--accent-bd)]"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.99.66-2.25 1.05-3.72 1.05-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38z"
              />
            </svg>
            Continuar con Google
          </a>
        </>
      ) : null}
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
