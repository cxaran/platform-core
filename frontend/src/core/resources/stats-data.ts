import "server-only";

import { cookies } from "next/headers";

import type { ResourceStatsResponse } from "@/core/api/contracts";
import { serverApi } from "@/core/api/server-client";
import { expandMultiValueParams } from "@/core/resources/filterable";
import {
  buildListSearchParams,
  type FilterableControls,
  type ResourceListQuery,
} from "@/core/resources/list-query";

/**
 * Agregados del pie de tabla (``list.stats_url``), calculados por el backend bajo
 * TODOS los filtros activos. Es un realce, no una dependencia: cualquier error
 * devuelve ``null`` y la tabla se renderiza sin totales.
 */
export async function getResourceStats(
  statsUrl: string,
  fieldNames: readonly string[],
  query: ResourceListQuery,
  controls: FilterableControls,
): Promise<ResourceStatsResponse | null> {
  if (
    fieldNames.length === 0 ||
    !statsUrl.startsWith("/api/") ||
    statsUrl.startsWith("//") ||
    statsUrl.includes("://") ||
    statsUrl.includes("?") ||
    statsUrl.includes("#")
  ) {
    return null;
  }
  const params = buildListSearchParams(query, controls);
  params.delete("limit");
  params.delete("offset");
  params.set("fields", fieldNames.join(","));
  const expanded = expandMultiValueParams(params);
  const cookie = (await cookies()).toString();
  try {
    return await serverApi<ResourceStatsResponse>(`${statsUrl}?${expanded.toString()}`, {
      cookie,
    });
  } catch {
    return null;
  }
}
