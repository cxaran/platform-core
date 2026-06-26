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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#dbeafe,transparent_28rem),linear-gradient(135deg,#f8fafc,#eef2ff)] px-4 py-8 text-slate-950 sm:py-12">
      <BootstrapWizard status={status} />
    </main>
  );
}
