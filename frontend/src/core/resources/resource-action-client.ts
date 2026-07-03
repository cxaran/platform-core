"use client";

import type { ResourceActionCapability } from "@/core/api/contracts";
import { browserApi } from "@/core/api/browser-client";

import { actionBody, resolveActionUrl } from "./resource-action";

function assertInternalApiPath(path: string): void {
  if (
    !path.startsWith("/api/") ||
    path.startsWith("//") ||
    path.includes("://") ||
    path.includes("?") ||
    path.includes("#")
  ) {
    throw new Error("Ruta de acción inválida.");
  }
}

/**
 * Ejecuta una acción declarada: método y URL desde el contrato. El cuerpo es
 * ``request.fixed_body`` exacto, o el payload allowlisted de ``input_schema``, o vacío.
 * ``payload`` sólo aplica a acciones con ``input_schema``; para ``fixed_body`` se
 * ignora (nunca se mezclan campos de usuario). No usa Server Actions ni rutas internas
 * de Next.
 */
export function executeAction(
  action: ResourceActionCapability,
  placeholder: string,
  id: string,
  payload?: Record<string, unknown>,
): Promise<unknown> {
  const url = resolveActionUrl(action, placeholder, id);
  assertInternalApiPath(url);
  return browserApi<unknown>(url, {
    method: action.method,
    body: actionBody(action, payload),
  });
}
