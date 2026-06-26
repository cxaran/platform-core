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

export class FormContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormContractError";
  }
}

export function assertSupportedCreateForm(form: ResourceFormCapability): void {
  if (form.method !== "POST") {
    throw new FormContractError("El formulario de creación debe usar POST.");
  }

  const seen = new Set<string>();
  for (const field of form.fields) {
    if (!field.name || seen.has(field.name)) {
      throw new FormContractError("Formulario de creación con campos inválidos.");
    }
    seen.add(field.name);

    if (!field.widget || !SUPPORTED_CREATE_WIDGETS.has(field.widget)) {
      throw new FormContractError(`Widget de creación no soportado: ${field.widget}.`);
    }
  }
}

export function buildCreatePayload(
  fields: readonly ResourceFormFieldCapability[],
  formData: FormData,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const field of fields) {
    if (field.widget === "switch") {
      payload[field.name] = formData.has(field.name);
      continue;
    }

    const raw = formData.get(field.name);
    payload[field.name] = typeof raw === "string" ? raw : "";
  }

  return payload;
}
