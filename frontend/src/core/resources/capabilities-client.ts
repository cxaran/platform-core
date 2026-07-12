import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ApiRequestError } from "@/core/api/api-error";
import type {
  ResourceCapability,
  ResourceCatalog,
  ResourceCatalogResponse,
} from "@/core/api/contracts";
import { serverApi } from "@/core/api/server-client";

async function currentCookie(): Promise<string> {
  return (await cookies()).toString();
}

/**
 * Catálogo de recursos visibles para el usuario actual, resuelto en servidor.
 *
 * Deduplicado con ``cache()`` solo dentro del mismo render/request (layout y
 * dashboard comparten una única petición). No hay cache entre usuarios ni entre
 * peticiones: ``serverApi`` fija ``cache: "no-store"``. Un 401 (carrera de sesión)
 * redirige a ``/login`` en lugar de devolver un catálogo vacío.
 */
export const getResourceCatalog = cache(async (): Promise<ResourceCatalog> => {
  try {
    // El endpoint devuelve el envelope {resources, navigation_modules}; se
    // desenvuelve a la lista de recursos (los módulos de navegación no se usan
    // en la base). serverApi fija cache: "no-store".
    const catalog = await serverApi<ResourceCatalogResponse>("/api/v1/resources", {
      cookie: await currentCookie(),
    });
    return catalog.resources;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      redirect("/login");
    }
    throw error;
  }
});

/**
 * Capability de un recurso concreto. ``null`` para 404 (no distingue inexistente de
 * oculto); 401 redirige a ``/login``; el resto se propaga a la error boundary.
 *
 * Pieza de infraestructura para Commit 5: aún no tiene consumidor en una ruta dinámica.
 */
export async function getResourceCapability(
  resourceName: string,
): Promise<ResourceCapability | null> {
  try {
    return await serverApi<ResourceCapability>(
      `/api/v1/resources/${encodeURIComponent(resourceName)}`,
      { cookie: await currentCookie() },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) {
      if (error.status === 404) {
        return null;
      }
      if (error.status === 401) {
        redirect("/login");
      }
    }
    throw error;
  }
}
