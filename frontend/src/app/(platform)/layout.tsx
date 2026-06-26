import { redirect } from "next/navigation";

import { PlatformShell } from "@/components/layout/PlatformShell";
import { SessionProvider } from "@/core/auth/SessionProvider";
import { getSession } from "@/core/auth/session";
import { getBootstrapStatus } from "@/core/bootstrap/bootstrap-server";
import { getResourceCatalog } from "@/core/resources/capabilities-client";

export default async function PlatformLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  if (!session) {
    const status = await getBootstrapStatus();
    redirect(status.setup_required ? "/setup" : "/login");
  }
  const resources = await getResourceCatalog();

  return (
    <SessionProvider initialSession={session}>
      <PlatformShell session={session} resources={resources}>
        {children}
      </PlatformShell>
    </SessionProvider>
  );
}
