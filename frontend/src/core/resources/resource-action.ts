import type { ResourceActionCapability } from "@/core/api/contracts";

export const ADMIN_COVERAGE_MESSAGE =
  "Esta acción no está disponible porque debe permanecer al menos un administrador con acceso completo.";

export class ActionContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionContractError";
  }
}

/**
 * URL resuelta de la acción sustituyendo el token ``{placeholder}`` declarado por
 * ``item_reference`` (nunca asume ``id``). Módulo sin dependencias runtime para que
 * la lógica sea verificable con pruebas puras.
 */
export function resolveActionUrl(
  action: ResourceActionCapability,
  placeholder: string,
  id: string,
): string {
  const token = `{${placeholder}}`;
  if (!action.url_template.includes(token)) {
    throw new ActionContractError(
      `La plantilla de la acción no contiene el token ${token}.`,
    );
  }
  return action.url_template.replace(token, encodeURIComponent(id));
}

/**
 * Cuerpo exacto a enviar: copia de ``request.fixed_body`` o ``undefined`` si la
 * acción no declara request. El frontend no agrega ni modifica campos; la copia
 * evita mutar el contrato compartido.
 */
export function actionBody(
  action: ResourceActionCapability,
): Record<string, unknown> | undefined {
  if (!action.request) {
    return undefined;
  }
  return { ...action.request.fixed_body };
}

/** Solo se abre el diálogo cuando el contrato exige confirmación. */
export function actionRequiresConfirmation(action: ResourceActionCapability): boolean {
  return Boolean(action.confirmation?.required);
}

/** Mensaje de error seguro (de negocio), nunca detalle técnico. */
export function actionErrorMessage(status: number, code: string | undefined): string {
  if (status === 409 && code === "admin_coverage_required") {
    return ADMIN_COVERAGE_MESSAGE;
  }
  return "No se pudo completar la acción. Inténtalo nuevamente.";
}
