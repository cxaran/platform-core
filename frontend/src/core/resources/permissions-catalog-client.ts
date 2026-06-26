import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ApiRequestError } from "@/core/api/api-error";
import type { PermissionsCatalog } from "@/core/api/contracts";
import { serverApi } from "@/core/api/server-client";

class InvalidCatalogPathError extends Error {
  constructor() {
    super("La ruta del catálogo de permisos no es un path interno válido.");
    this.name = "InvalidCatalogPathError";
  }
}

// Defensa: solo se acepta un path interno relativo bajo /api/, sin host, query ni
// fragmento. La URL proviene del contrato (api_path del recurso u options.url de la
// relación), pero igual se valida antes de usarse.
function assertInternalApiPath(path: string): void {
  if (
    typeof path !== "string" ||
    !path.startsWith("/api/") ||
    path.startsWith("//") ||
    path.includes("://") ||
    path.includes("?") ||
    path.includes("#")
  ) {
    throw new InvalidCatalogPathError();
  }
}

/**
 * Catálogo agrupado de permisos resuelto en servidor desde la URL declarada por el
 * contrato. 401 → ``/login``; 403 → ``null`` (la página responde ``notFound()``);
 * el resto se propaga a la error boundary.
 */
export async function getPermissionsCatalog(
  path: string,
): Promise<PermissionsCatalog | null> {
  assertInternalApiPath(path);
  try {
    return await serverApi<PermissionsCatalog>(path, {
      cookie: (await cookies()).toString(),
    });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      if (error.status === 401) {
        redirect("/login");
      }
      if (error.status === 403) {
        return null;
      }
    }
    throw error;
  }
}
