"use client";

import { browserApi } from "@/core/api/browser-client";
import type { ResourceCapability, ResourceCatalog, ResourceCatalogResponse } from "@/core/api/contracts";
import {
  buildListSearchParams,
  type FilterableControls,
  type ResourceListQuery,
} from "@/core/resources/list-query";
import type { ResourceListPage } from "@/core/resources/list-types";

// Fetch CLIENTE de un recurso del contrato para embeberlo en el shell chat-first (record panel,
// MP-CTRL-0125). Reusa el MISMO contrato y la MISMA serialización de query (buildListSearchParams)
// que la ruta /resources; sólo cambia el transporte (browserApi con la cookie del médico en vez de
// serverApi). No duplica el motor: la capability, columnas, filtros y acciones siguen saliendo del
// backend. La interacción profunda (orden/filtros/paginación/CRUD) se delega a la ruta /resources
// existente vía enlaces; aquí sólo se obtiene una vista acotada al paciente.

/** Catálogo completo de recursos visibles para la sesión (misma forma que getResourceCatalog,
 *  vía browser). Lo usa el copiloto para DERIVAR sus tools del contrato (deriveResourceTools). */
export async function fetchResourceCatalog(): Promise<ResourceCatalog> {
  const response = await browserApi<ResourceCatalogResponse>("/api/v1/resources", {
    method: "GET",
  });
  return response.resources;
}

/** Capability de un recurso (misma forma que getResourceCapability, vía browser). */
export function fetchResourceCapability(resourceName: string): Promise<ResourceCapability> {
  return browserApi<ResourceCapability>(
    `/api/v1/resources/${encodeURIComponent(resourceName)}`,
    { method: "GET" },
  );
}

/** Página de lista de un recurso para un query ya validado (serializado por la allowlist). */
export function fetchResourceListPage(
  apiPath: string,
  query: ResourceListQuery,
  controls: FilterableControls,
): Promise<ResourceListPage> {
  const queryString = buildListSearchParams(query, controls).toString();
  return browserApi<ResourceListPage>(`${apiPath}?${queryString}`, { method: "GET" });
}
