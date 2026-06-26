"use client";

import type { ResourceFormCapability } from "@/core/api/contracts";
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
