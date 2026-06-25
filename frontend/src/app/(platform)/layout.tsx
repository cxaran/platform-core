import { PlatformShell } from "@/components/layout/PlatformShell";
import { SessionProvider } from "@/core/auth/SessionProvider";
import { requireSession } from "@/core/auth/session";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await requireSession();

  return (
    <SessionProvider initialSession={session}>
      <PlatformShell session={session}>{children}</PlatformShell>
    </SessionProvider>
  );
}
