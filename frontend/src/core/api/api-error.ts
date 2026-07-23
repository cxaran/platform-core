import { translateValidationErrors } from "./validation-messages";

export type ApiErrorItem = {
  field?: string | null;
  message: string;
  // Error estructurado de Pydantic (validation_error): tipo estándar y sus
  // constraints; la traducción a español vive en validation-messages.ts.
  type?: string | null;
  ctx?: Record<string, string | number | boolean> | null;
};

export type ApiErrorBody = {
  code: string;
  message: string;
  errors?: ApiErrorItem[] | null;
};

export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiRequestError";
    this.status = status;
    this.body = body;
  }
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}

export function normalizeApiError(status: number, value: unknown): ApiErrorBody {
  if (isApiErrorBody(value)) {
    // Punto único por el que pasa toda respuesta de error: los items de
    // validación llegan estructurados y aquí se traducen a mensajes UX.
    return { ...value, errors: translateValidationErrors(value.errors) };
  }

  return {
    code: `http_${status}`,
    message: "No se pudo procesar la respuesta del servidor",
  };
}

export function networkApiError(): ApiErrorBody {
  return {
    code: "network_error",
    message: "No se pudo conectar con el servidor",
  };
}
