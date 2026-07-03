import { redirect } from "next/navigation";

import { BootstrapWizard } from "@/features/bootstrap/BootstrapWizard";
import { getSession } from "@/core/auth/session";
import { getBootstrapStatus } from "@/core/bootstrap/bootstrap-server";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const session = await getSession();
  if (session) {
    redirect("/");
  }

  const status = await getBootstrapStatus();
  if (!status.setup_required) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen bg-[var(--bg)] px-4 py-8 text-[var(--tx)] sm:py-12">
      <BootstrapWizard status={status} />
    </main>
  );
}
