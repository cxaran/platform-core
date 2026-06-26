/**
 * Sustituye el token ``{placeholder}`` declarado por ``item_reference`` en una
 * plantilla de URL del contrato (detail, update, acciones), codificando el valor.
 *
 * No asume ``id``: el ``placeholder`` proviene del contrato. Si la plantilla no
 * contiene el token, lanza para no construir una URL silenciosamente inválida.
 */
export class ItemReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ItemReferenceError";
  }
}

export function fillPlaceholder(
  template: string,
  placeholder: string,
  value: string,
): string {
  const token = `{${placeholder}}`;
  if (!template.includes(token)) {
    throw new ItemReferenceError(
      `La plantilla no contiene el token ${token} declarado por item_reference.`,
    );
  }
  return template.replace(token, encodeURIComponent(value));
}
