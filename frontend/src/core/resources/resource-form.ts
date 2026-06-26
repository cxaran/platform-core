import type {
  ResourceFormCapability,
  ResourceFormFieldCapability,
  WidgetType,
} from "@/core/api/contracts";

const SUPPORTED_CREATE_WIDGETS = new Set<WidgetType>([
  "text",
  "email",
  "password",
  "switch",
  "textarea",
]);

// La actualización no admite ``password``: el cambio de contraseña, si existe, tiene
// su propio contrato y flujo separado.
const SUPPORTED_UPDATE_WIDGETS = new Set<WidgetType>([
  "text",
  "email",
  "switch",
  "textarea",
]);

export class FormContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormContractError";
  }
}

function assertSupportedFields(
  form: ResourceFormCapability,
  supported: Set<WidgetType>,
  context: string,
): void {
  const seen = new Set<string>();
  for (const field of form.fields) {
    if (!field.name || seen.has(field.name)) {
      throw new FormContractError(`Formulario de ${context} con campos inválidos.`);
    }
    seen.add(field.name);

    if (!field.widget || !supported.has(field.widget)) {
      throw new FormContractError(`Widget de ${context} no soportado: ${field.widget}.`);
    }
  }
}

export function assertSupportedCreateForm(form: ResourceFormCapability): void {
  if (form.method !== "POST") {
    throw new FormContractError("El formulario de creación debe usar POST.");
  }
  assertSupportedFields(form, SUPPORTED_CREATE_WIDGETS, "creación");
}

export function assertSupportedUpdateForm(form: ResourceFormCapability): void {
  if (form.method !== "PATCH" && form.method !== "PUT") {
    throw new FormContractError("El formulario de actualización debe usar PATCH o PUT.");
  }
  assertSupportedFields(form, SUPPORTED_UPDATE_WIDGETS, "actualización");
}

function fieldValue(
  field: ResourceFormFieldCapability,
  formData: FormData,
): unknown {
  if (field.widget === "switch") {
    return formData.has(field.name);
  }
  const raw = formData.get(field.name);
  return typeof raw === "string" ? raw : "";
}

export function buildCreatePayload(
  fields: readonly ResourceFormFieldCapability[],
  formData: FormData,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    payload[field.name] = fieldValue(field, formData);
  }
  return payload;
}

// Payload allowlisted de actualización: solo campos editables declarados.
export function buildUpdatePayload(
  fields: readonly ResourceFormFieldCapability[],
  formData: FormData,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.editable === false) {
      continue;
    }
    payload[field.name] = fieldValue(field, formData);
  }
  return payload;
}
