"use client";

import { browserApi } from "@/core/api/browser-client";
import type { ResourceFacetsResponse } from "@/core/api/contracts";
import { expandMultiValueParams } from "@/core/resources/filterable";

/**
 * Facetas de una columna (autofiltro estilo Excel): valores únicos + conteos bajo
 * los filtros ACTIVOS de las demás columnas (el backend excluye el filtro propio).
 *
 * ``facetsUrl`` viene del contrato (``list.facets_url``); misma defensa que el
 * cliente de listas: solo un path interno bajo /api/. ``params`` es el estado
 * canónico de la página (los multi unidos se expanden a repetidos aquí).
 */
export async function fetchResourceFacets(
  facetsUrl: string,
  field: string,
  params: Readonly<Record<string, string>>,
): Promise<ResourceFacetsResponse> {
  if (
    !facetsUrl.startsWith("/api/") ||
    facetsUrl.startsWith("//") ||
    facetsUrl.includes("://") ||
    facetsUrl.includes("?") ||
    facetsUrl.includes("#")
  ) {
    throw new Error("facets_url inválida en el contrato.");
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    // limit/offset son de paginación de la lista; las facetas no paginan filas.
    if (key === "limit" || key === "offset") continue;
    search.set(key, value);
  }
  search.set("field", field);
  const expanded = expandMultiValueParams(search);
  return browserApi<ResourceFacetsResponse>(`${facetsUrl}?${expanded.toString()}`);
}
