"use client";

import type {
  HttpMethod,
  ResourceFormCapability,
} from "@/core/api/contracts";
import { browserApi } from "@/core/api/browser-client";

function assertInternalApiPath(path: string): void {
  if (
    !path.startsWith("/api/") ||
    path.startsWith("//") ||
    path.includes("://") ||
    path.includes("?") ||
    path.includes("#")
  ) {
    throw new Error("Ruta de mutación inválida.");
  }
}

export function createResource(
  form: ResourceFormCapability,
  payload: Record<string, unknown>,
): Promise<unknown> {
  assertInternalApiPath(form.url_template);
  return browserApi<unknown>(form.url_template, {
    method: form.method,
    body: payload,
  });
}

/**
 * Actualización de un recurso: envía el payload allowlisted con el método y la URL
 * declarados por el contrato. La URL ya viene resuelta (placeholder sustituido).
 */
export function updateResource(
  url: string,
  method: HttpMethod,
  payload: Record<string, unknown>,
): Promise<unknown> {
  assertInternalApiPath(url);
  return browserApi<unknown>(url, {
    method,
    body: payload,
  });
}

/**
 * Reemplazo atómico de una relación: envía la lista completa de valores objetivo en
 * el campo declarado por el contrato. La ruta ya viene resuelta (``{id}`` sustituido)
 * y se valida como path interno antes de usarse.
 */
export function replaceRelation(
  url: string,
  method: HttpMethod,
  requestField: string,
  values: readonly string[],
): Promise<unknown> {
  assertInternalApiPath(url);
  return browserApi<unknown>(url, {
    method,
    body: { [requestField]: values },
  });
}
