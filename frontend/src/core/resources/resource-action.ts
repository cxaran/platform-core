import type {
  ActionCondition,
  ResourceActionCapability,
  ResourceFormFieldCapability,
} from "@/core/api/contracts";

import { buildCreatePayload } from "./resource-form.ts";

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
 * Campos declarados del formulario de entrada (B2) de la acción, o lista vacía si la
 * acción no declara ``input_schema``.
 */
export function actionInputFields(
  action: ResourceActionCapability,
): readonly ResourceFormFieldCapability[] {
  return action.input_schema?.fields ?? [];
}

/** ¿La acción declara un formulario de entrada (``input_schema``)? */
export function actionHasInputSchema(action: ResourceActionCapability): boolean {
  return Boolean(action.input_schema);
}

/**
 * Construye el payload capturado por el diálogo reutilizando exactamente la semántica
 * de los formularios create/update: allowlist estricta de los campos declarados en
 * ``input_schema.fields`` (``switch`` -> boolean, el resto -> string). No agrega
 * defaults ni campos no declarados.
 */
export function buildActionPayload(
  action: ResourceActionCapability,
  formData: FormData,
): Record<string, unknown> {
  return buildCreatePayload(actionInputFields(action), formData);
}

/**
 * Cuerpo exacto a enviar.
 *
 * - ``request.fixed_body``: copia exacta; nunca se mezclan campos de usuario.
 * - ``input_schema``: allowlist de los campos declarados, tomada del payload capturado
 *   (cualquier clave no declarada se descarta aquí, defensa adicional).
 * - sin request ni input_schema: ``undefined``.
 *
 * ``fixed_body`` e ``input_schema`` son excluyentes (el backend lo garantiza en
 * ``ActionDef``); si llegaran juntos el contrato está corrupto y se rechaza.
 */
export function actionBody(
  action: ResourceActionCapability,
  payload?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (action.request && action.input_schema) {
    throw new ActionContractError(
      "La acción declara 'request' e 'input_schema' a la vez; contrato inválido.",
    );
  }
  if (action.request) {
    return { ...action.request.fixed_body };
  }
  if (action.input_schema) {
    const body: Record<string, unknown> = {};
    for (const field of action.input_schema.fields) {
      if (payload && Object.prototype.hasOwnProperty.call(payload, field.name)) {
        body[field.name] = payload[field.name];
      }
    }
    return body;
  }
  return undefined;
}

/** El contrato exige confirmación explícita del usuario. */
export function actionRequiresConfirmation(action: ResourceActionCapability): boolean {
  return Boolean(action.confirmation?.required);
}

/**
 * Se abre el diálogo cuando el contrato exige confirmación o cuando la acción declara
 * ``input_schema``: aun con ``confirmation.required`` en false, el usuario necesita el
 * formulario para capturar los datos.
 */
export function shouldOpenDialog(action: ResourceActionCapability): boolean {
  return actionRequiresConfirmation(action) || actionHasInputSchema(action);
}

// --- Evaluación client-side del DSL de estado (visible_when / enabled_when) ---
//
// Es sólo guía de UI: oculta/deshabilita acciones que no aplican al estado del row.
// El backend sigue siendo la autoridad y revalida cada transición. La evaluación es
// conservadora: ante cualquier cosa que no se pueda evaluar con certeza, NO se oculta
// ni se deshabilita la acción (para no bloquear al usuario por un contrato/row raro).

function isScalar(value: unknown): value is string | number | boolean {
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean";
}

/**
 * Evalúa un predicado atómico contra el row. Conservador: predicado malformado,
 * campo ausente o ``value`` con forma inesperada para el operador -> ``true`` (no
 * bloquea).
 */
function evaluatePredicate(
  predicate: ActionCondition["all"][number],
  item: Record<string, unknown>,
): boolean {
  if (!predicate || typeof predicate.field !== "string") {
    return true;
  }
  // Campo ausente en el row: no se puede evaluar con certeza -> mostrar.
  if (!Object.prototype.hasOwnProperty.call(item, predicate.field)) {
    return true;
  }
  const actual = item[predicate.field];
  const value = predicate.value;
  switch (predicate.operator) {
    case "eq":
      return isScalar(value) ? actual === value : true;
    case "neq":
      return isScalar(value) ? actual !== value : true;
    case "in":
      return Array.isArray(value) ? value.includes(actual) : true;
    case "not_in":
      return Array.isArray(value) ? !value.includes(actual) : true;
    case "is_null":
      return actual === null || actual === undefined;
    case "not_null":
      return actual !== null && actual !== undefined;
    default:
      // Operador no soportado (contrato corrupto) -> conservador.
      return true;
  }
}

/**
 * Evalúa client-side una condición de estado (``visible_when``/``enabled_when``)
 * contra el row serializado del item.
 *
 * - ``null``/``undefined`` -> ``true`` (sin condición declarada, siempre aplica).
 * - ``all`` es una conjunción: todos los predicados deben cumplirse.
 * - Conservador: si la condición o algún predicado no se pueden evaluar (contrato
 *   malformado, campo ausente, ``value`` con forma inesperada) devuelve ``true`` y la
 *   acción se muestra. El backend revalida el estado y es la autoridad final.
 */
export function evaluateActionCondition(
  condition: ActionCondition | null | undefined,
  item: Record<string, unknown>,
): boolean {
  if (!condition || !Array.isArray(condition.all)) {
    return true;
  }
  return condition.all.every((predicate) => evaluatePredicate(predicate, item));
}

/** ¿La acción es visible para el row? (``visible_when`` evaluado, conservador). */
export function isActionVisible(
  action: ResourceActionCapability,
  item: Record<string, unknown>,
): boolean {
  return evaluateActionCondition(action.visible_when, item);
}

/** ¿La acción está habilitada para el row? (``enabled_when`` evaluado, conservador). */
export function isActionEnabled(
  action: ResourceActionCapability,
  item: Record<string, unknown>,
): boolean {
  return evaluateActionCondition(action.enabled_when, item);
}

/** Acciones que deben proyectarse en un row: filtra por ``visible_when``. */
export function visibleActionsForRow(
  actions: readonly ResourceActionCapability[],
  item: Record<string, unknown>,
): ResourceActionCapability[] {
  return actions.filter((action) => isActionVisible(action, item));
}

/** Acciones ACCIONABLES en un row: visibles Y habilitadas. Para superficies
 * compactas (agenda) donde un botón deshabilitado no aporta; la tabla, en cambio,
 * muestra las visibles-deshabilitadas con motivo (``enabled_when``). */
export function actionableActionsForRow(
  actions: readonly ResourceActionCapability[],
  item: Record<string, unknown>,
): ResourceActionCapability[] {
  return actions.filter(
    (action) => isActionVisible(action, item) && isActionEnabled(action, item),
  );
}

/** Mensaje de error seguro (de negocio), nunca detalle técnico. */
export function actionErrorMessage(status: number, code: string | undefined): string {
  if (status === 409 && code === "admin_coverage_required") {
    return ADMIN_COVERAGE_MESSAGE;
  }
  return "No se pudo completar la acción. Inténtalo nuevamente.";
}
