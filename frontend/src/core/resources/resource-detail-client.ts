import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ApiRequestError } from "@/core/api/api-error";
import { serverApi } from "@/core/api/server-client";

class InvalidDetailPathError extends Error {
  constructor() {
    super("La ruta de detalle no es un path interno válido.");
    this.name = "InvalidDetailPathError";
  }
}

function assertInternalApiPath(path: string): void {
  if (
    typeof path !== "string" ||
    !path.startsWith("/api/") ||
    path.startsWith("//") ||
    path.includes("://") ||
    path.includes("#")
  ) {
    throw new InvalidDetailPathError();
  }
}

/**
 * Lectura individual de un recurso resuelta en servidor, como fuente de verdad para
 * precargar el formulario de edición (no se reutiliza la fila de tabla).
 *
 * 401 → ``/login``; 403/404 → ``null`` (la página responde ``notFound()``, sin
 * distinguir inexistente de no visible); el resto se propaga a la error boundary.
 */
export async function getResourceDetail(
  detailUrl: string,
): Promise<Record<string, unknown> | null> {
  assertInternalApiPath(detailUrl);
  try {
    const raw = await serverApi<unknown>(detailUrl, {
      cookie: (await cookies()).toString(),
    });
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return null;
    }
    return raw as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiRequestError) {
      if (error.status === 401) {
        redirect("/login");
      }
      if (error.status === 403 || error.status === 404) {
        return null;
      }
    }
    throw error;
  }
}
