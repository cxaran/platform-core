import Link from "next/link";
import { redirect } from "next/navigation";

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
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <section className="w-full max-w-sm rounded-xl bg-white p-6 shadow-sm">
        <div className="mb-6">
          <p className="text-sm text-slate-500">Platform Core</p>
          <h1 className="text-2xl font-semibold text-slate-950">Iniciar sesión</h1>
        </div>
        <LoginForm />
        <div className="mt-6 space-y-2 text-sm text-slate-600">
          {policy.password_reset_enabled ? (
            <p>
              <Link href="/forgot-password" className="font-medium text-slate-900 underline-offset-2 hover:underline">
                ¿Olvidaste tu contraseña?
              </Link>
            </p>
          ) : null}
          {policy.registration_enabled ? (
            <p>
              ¿No tienes cuenta?{" "}
              <Link href="/register" className="font-medium text-slate-900 underline-offset-2 hover:underline">
                Crear cuenta
              </Link>
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
