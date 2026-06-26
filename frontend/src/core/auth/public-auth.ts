import type { ApiRequestError } from "@/core/api/api-error";

export const RATE_LIMITED_MESSAGE =
  "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";
export const GENERIC_AUTH_ERROR =
  "No se pudo completar la solicitud. Inténtalo nuevamente.";

export type AuthFieldErrors = Record<string, string[]>;

/** Mensaje general seguro: nunca expone detalles internos, tokens ni correos. */
export function publicAuthGeneralError(error: ApiRequestError): string {
  if (error.status === 429) {
    return RATE_LIMITED_MESSAGE;
  }
  if (error.status === 403) {
    return "Esta acción no está disponible en este momento.";
  }
  return GENERIC_AUTH_ERROR;
}

/**
 * Mapea errores 422 solo a los campos declarados del formulario; cualquier otro
 * error o campo no declarado cae a un mensaje general seguro.
 */
export function mapAuthFieldErrors(
  error: ApiRequestError,
  allowedFields: ReadonlySet<string>,
): { general: string | null; fields: AuthFieldErrors } {
  if (error.status === 422 && error.body.errors) {
    const fields: AuthFieldErrors = {};
    let general: string | null = null;
    for (const item of error.body.errors) {
      const field = item.field?.replace(/^body\./, "");
      if (field && allowedFields.has(field)) {
        fields[field] = [...(fields[field] ?? []), item.message];
      } else {
        general = "Revisa los datos ingresados.";
      }
    }
    return { general, fields };
  }
  return { general: publicAuthGeneralError(error), fields: {} };
}
