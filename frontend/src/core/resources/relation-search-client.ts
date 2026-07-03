"use client";

import { browserApi } from "@/core/api/browser-client";
import type { ResourceCapability } from "@/core/api/contracts";
import type { ResourceRow } from "@/core/resources/list-types";

// Cliente de navegador del selector de relación (F5). Reusa la capa genérica de recursos:
// resuelve la capability del recurso destino para conocer su ``api_path`` y su búsqueda, y
// luego consulta el mismo endpoint de lista que ya usa la pantalla del recurso. Todo con
// ``browserApi`` (credentials:"include").

export type RelationSearchMeta = {
  apiPath: string;
  searchEnabled: boolean;
  searchMinLength: number;
};

/** Metadata de búsqueda del recurso destino (api_path + parámetros de búsqueda). */
export async function fetchRelationMeta(resource: string): Promise<RelationSearchMeta> {
  const capability = await browserApi<ResourceCapability>(
    `/api/v1/resources/${encodeURIComponent(resource)}`,
  );
  const search = capability.list?.search;
  return {
    apiPath: capability.api_path,
    searchEnabled: Boolean(search?.enabled),
    // Si el recurso declara mínimo, se respeta; si no, al menos 1 carácter.
    searchMinLength: search?.min_length ?? 1,
  };
}

/** Busca items del recurso destino por texto libre (paginado, primera página). */
export async function searchRelationItems(
  apiPath: string,
  query: string,
  limit = 10,
): Promise<ResourceRow[]> {
  const params = new URLSearchParams();
  const term = query.trim();
  if (term !== "") {
    params.set("q", term);
  }
  params.set("limit", String(limit));
  params.set("offset", "0");
  const page = await browserApi<{ items?: ResourceRow[] }>(`${apiPath}?${params.toString()}`);
  return Array.isArray(page.items) ? page.items : [];
}

/** Lee un item del recurso destino por su id (para precargar la etiqueta en edición). */
export async function fetchRelationItem(
  apiPath: string,
  id: string,
): Promise<ResourceRow | null> {
  try {
    return await browserApi<ResourceRow>(`${apiPath}/${encodeURIComponent(id)}`);
  } catch {
    // Sin permiso de lectura individual o item inexistente: el selector cae a manual.
    return null;
  }
}
