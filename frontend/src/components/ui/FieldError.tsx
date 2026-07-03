// Mensaje de error de un campo. Cuando se le pasa ``id`` se asocia al input vía
// aria-describedby y se anuncia (role=alert) para usuarios de lector de pantalla.
export function FieldError({
  message,
  id,
}: Readonly<{ message?: string | null; id?: string }>) {
  if (!message) {
    return null;
  }

  return (
    <p id={id} role="alert" className="text-sm text-[var(--danger)]">
      {message}
    </p>
  );
}
