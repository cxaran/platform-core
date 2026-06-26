import Link from "next/link";

/** Marco visual común a las páginas públicas de auth. */
export function PublicAuthShell({
  title,
  description,
  children,
  footer,
}: Readonly<{
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}>) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <section className="w-full max-w-sm rounded-xl bg-white p-6 shadow-sm">
        <div className="mb-6">
          <p className="text-sm text-slate-500">Platform Core</p>
          <h1 className="text-2xl font-semibold text-slate-950">{title}</h1>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
        {children}
        {footer ? <div className="mt-6 text-sm text-slate-600">{footer}</div> : null}
      </section>
    </main>
  );
}

export function AuthLink({ href, children }: Readonly<{ href: string; children: React.ReactNode }>) {
  return (
    <Link href={href} className="font-medium text-slate-900 underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}
