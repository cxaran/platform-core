export function EmptyState({
  title,
  description,
}: Readonly<{
  title: string;
  description?: string;
}>) {
  return (
    <section className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
      <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      {description ? <p className="mt-2 text-sm text-slate-600">{description}</p> : null}
    </section>
  );
}
