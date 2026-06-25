import { EmptyState } from "@/components/ui/EmptyState";
import { SessionUser } from "@/core/auth/types";

export function PlatformShell({
  session,
  children,
}: Readonly<{
  session: SessionUser;
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-sm text-slate-500">Platform Core</p>
            <h1 className="text-lg font-semibold">Panel</h1>
          </div>
          <div className="text-right text-sm">
            <p className="font-medium">{session.name}</p>
            <p className="text-slate-500">{session.email}</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <nav className="mb-6">
          <EmptyState
            title="Sin módulos disponibles"
            description="La navegación se alimentará desde capabilities cuando el backend exponga el catálogo de recursos."
          />
        </nav>
        {children}
      </main>
    </div>
  );
}
