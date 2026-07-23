// Traducción UX (español) de los errores de validación estructurados de la API.
//
// El backend envía cada item con `type` + `ctx` (el error estándar de Pydantic,
// p. ej. "string_too_short" + {min_length: 4}) y deja `message` crudo. Aquí se
// construye el mensaje visible; se aplica de forma global en normalizeApiError,
// así que TODA llamada a la API recibe mensajes ya traducidos.
//
// Reglas:
// - item sin `type`: mensaje de negocio del backend, ya en español → tal cual;
// - `value_error`: mensaje de un validador de dominio (ya en español, con el
//   prefijo técnico "Value error, " de Pydantic) → se limpia y preserva; el caso
//   especial del email de Pydantic (texto en inglés) se localiza;
// - tipo desconocido: mensaje general seguro, sin filtrar texto interno en inglés.

import type { ApiErrorItem } from "./api-error";

export function validationMessage(item: ApiErrorItem): string {
  const ctx = item.ctx ?? {};

  switch (item.type ?? "") {
    case "":
      return item.message;
    case "missing":
      return "Este campo es obligatorio.";
    case "string_too_short":
      return ctx.min_length != null
        ? `Debe tener al menos ${ctx.min_length} caracteres.`
        : "El valor es demasiado corto.";
    case "string_too_long":
      return ctx.max_length != null
        ? `Debe tener como máximo ${ctx.max_length} caracteres.`
        : "El valor es demasiado largo.";
    case "greater_than_equal":
      return `Debe ser mayor o igual a ${ctx.ge}.`;
    case "less_than_equal":
      return `Debe ser menor o igual a ${ctx.le}.`;
    case "greater_than":
      return `Debe ser mayor que ${ctx.gt}.`;
    case "less_than":
      return `Debe ser menor que ${ctx.lt}.`;
    case "value_error": {
      const cleaned = item.message.replace(/^Value error, /u, "").trim();
      if (cleaned.toLowerCase().includes("valid email address")) {
        return "Correo electrónico inválido.";
      }
      return cleaned || "El valor ingresado no es válido.";
    }
    default:
      return "El valor ingresado no es válido.";
  }
}

export function translateValidationErrors(
  errors: ApiErrorItem[] | null | undefined,
): ApiErrorItem[] | null | undefined {
  if (!errors) {
    return errors;
  }
  return errors.map((item) => ({ ...item, message: validationMessage(item) }));
}
