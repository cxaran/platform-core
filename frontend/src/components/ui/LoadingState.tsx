export function LoadingState({ message = "Cargando..." }: Readonly<{ message?: string }>) {
  return <p className="text-sm text-slate-500">{message}</p>;
}
