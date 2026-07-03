export function LoadingState({ message = "Cargando..." }: Readonly<{ message?: string }>) {
  return <p className="text-sm text-[var(--tx3)]">{message}</p>;
}
