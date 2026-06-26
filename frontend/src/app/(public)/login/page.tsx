import { redirect } from "next/navigation";

import { LoginForm } from "@/features/auth/LoginForm";
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

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <section className="w-full max-w-sm rounded-xl bg-white p-6 shadow-sm">
        <div className="mb-6">
          <p className="text-sm text-slate-500">Platform Core</p>
          <h1 className="text-2xl font-semibold text-slate-950">Iniciar sesión</h1>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
