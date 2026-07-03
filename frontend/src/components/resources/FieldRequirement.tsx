/**
 * Indicador visual de si un campo de formulario es OBLIGATORIO u OPCIONAL, para que el médico lo
 * distinga de un vistazo (antes sólo viajaba en el atributo ``required``/``aria-required``, sin pista
 * visible). Se usa como sufijo del texto de la etiqueta. Obligatorio = asterisco rojo; opcional =
 * "(opcional)" tenue. El asterisco se oculta a lectores de pantalla (``aria-hidden``) porque la
 * obligatoriedad ya se comunica con ``aria-required`` en el control.
 */
export function RequiredHint({ required }: Readonly<{ required?: boolean }>) {
  if (required) {
    return (
      <span className="text-red-600" aria-hidden="true">
        {" "}
        *
      </span>
    );
  }
  return <span className="font-normal text-slate-400"> (opcional)</span>;
}
