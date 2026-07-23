"use client";

import type { FilterableControls } from "@/core/resources/filterable";
import type { ResourceListQuery } from "@/core/resources/list-query";
import { fetchResourceListPage } from "@/core/resources/embedded-list-client";

/**
 * Descarga por chunks del dataset a exportar: pide páginas de ``batch`` filas
 * (el max_limit del contrato) con OFFSET CONTINUO — a diferencia del multi-parte
 * de DynamicTable, aquí no se puede perder ni duplicar una fila entre archivos.
 * Cancelación cooperativa entre chunks (shouldCancel) y progreso por callback.
 * Cada request pasa por el RBAC del backend como cualquier página de la tabla.
 */
export async function fetchAllRows({
  apiPath,
  controls,
  baseQuery,
  batch,
  cap,
  onProgress,
  shouldCancel,
}: Readonly<{
  apiPath: string;
  controls: FilterableControls;
  // q/sort/filters del alcance elegido; limit/offset los maneja este loop.
  baseQuery: Omit<ResourceListQuery, "limit" | "offset">;
  batch: number;
  // Tope duro de filas a traer (p. ej. 1000 para PDF).
  cap: number;
  onProgress?: (downloaded: number, total: number) => void;
  shouldCancel?: () => boolean;
}>): Promise<{ rows: Record<string, unknown>[]; total: number; cancelled: boolean }> {
  const rows: Record<string, unknown>[] = [];
  let offset = 0;
  let total = 0;

  while (rows.length < cap) {
    if (shouldCancel?.()) {
      return { rows, total, cancelled: true };
    }
    const limit = Math.min(batch, cap - rows.length);
    const page = await fetchResourceListPage(
      apiPath,
      { ...baseQuery, limit, offset },
      controls,
    );
    rows.push(...(page.items as Record<string, unknown>[]));
    // Feeds sin total (``NoTotalCount``): ``total`` es null — se usa el número de filas
    // ya traídas como objetivo móvil de progreso y se corta por página corta / has_next.
    total = page.pagination.total ?? rows.length;
    onProgress?.(Math.min(rows.length, total), Math.min(total, cap));
    if (page.items.length < limit || !page.pagination.has_next) {
      break;
    }
    offset += page.items.length;
  }

  if (rows.length > cap) rows.length = cap;
  return { rows, total, cancelled: false };
}
