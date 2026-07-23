import { redirect } from "next/navigation";

import { PlatformShell } from "@/components/layout/PlatformShell";
import { getPublicBranding, logoPath } from "@/core/branding/public-branding";
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
  const branding = await getPublicBranding();

  return (
    <SessionProvider initialSession={session}>
      <PlatformShell
        session={session}
        resources={resources}
        brandName={branding?.name || "Platform Core"}
        brandLogoUrl={logoPath(branding)}
      >
        {children}
      </PlatformShell>
    </SessionProvider>
  );
}
