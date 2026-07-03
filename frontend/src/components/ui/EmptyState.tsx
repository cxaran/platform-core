export function EmptyState({
  title,
  description,
}: Readonly<{
  title: string;
  description?: string;
}>) {
  return (
    <section className="rounded-[14px] border border-dashed border-[var(--border2)] bg-[var(--panel)] p-8 text-center">
      <h2 className="text-base font-semibold text-[var(--tx)]">{title}</h2>
      {description ? <p className="mt-2 text-sm text-[var(--tx2)]">{description}</p> : null}
    </section>
  );
}
