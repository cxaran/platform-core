import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ApiRequestError } from "@/core/api/api-error";
import type { ResourceCapability } from "@/core/api/contracts";
import { serverApi } from "@/core/api/server-client";
import {
  buildFilterableControls,
  buildListSearchParams,
  type ResourceListQuery,
} from "@/core/resources/list-query";
import type { ResourceListPage, ResourceRow } from "@/core/resources/list-types";

class InvalidListResponseError extends Error {
  constructor() {
    super("La respuesta de la lista de recursos no tiene la forma esperada.");
    this.name = "InvalidListResponseError";
  }
}

// Defensa: ``api_path`` viene del backend, pero solo se acepta un path interno
// relativo bajo /api/, sin host, query ni fragmento. Cualquier otra cosa se rechaza
// sin intentar corregirla.
function assertInternalApiPath(path: string): void {
  if (
    typeof path !== "string" ||
    !path.startsWith("/api/") ||
    path.startsWith("//") ||
    path.includes("://") ||
    path.includes("?") ||
    path.includes("#")
  ) {
    throw new InvalidListResponseError();
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseListPage(raw: unknown): ResourceListPage {
  if (!isPlainObject(raw)) {
    throw new InvalidListResponseError();
  }

  const { items, pagination } = raw;
  if (!Array.isArray(items) || !isPlainObject(pagination)) {
    throw new InvalidListResponseError();
  }

  if (
    !Number.isInteger(pagination.limit) ||
    (pagination.limit as number) < 1 ||
    !isNonNegativeInteger(pagination.offset) ||
    !isNonNegativeInteger(pagination.total) ||
    typeof pagination.has_next !== "boolean"
  ) {
    throw new InvalidListResponseError();
  }

  const rows: ResourceRow[] = [];
  for (const item of items) {
    if (!isPlainObject(item)) {
      throw new InvalidListResponseError();
    }
    rows.push(item);
  }

  return {
    items: rows,
    pagination: {
      limit: pagination.limit as number,
      offset: pagination.offset,
      total: pagination.total,
      has_next: pagination.has_next,
    },
  };
}

/**
 * Página de un recurso ``view: "table"`` para un query state ya validado, resuelta
 * en servidor. 401 → ``/login``; 403 → ``null`` (la página responde ``notFound()``);
 * 5xx/red/respuesta inválida → error boundary. Los query params se reconstruyen solo
 * desde el estado validado (allowlist), nunca desde el ``searchParams`` crudo.
 */
export async function getResourceListPage(
  capability: ResourceCapability,
  query: ResourceListQuery,
): Promise<ResourceListPage | null> {
  if (capability.view !== "table" || !capability.list) {
    return null;
  }

  assertInternalApiPath(capability.api_path);
  // Reconstruye los controles desde la capability para serializar con una allowlist
  // ordenada (nunca itera query.filters directamente).
  const controls = buildFilterableControls(capability.list);
  const url = `${capability.api_path}?${buildListSearchParams(query, controls).toString()}`;
  const cookie = (await cookies()).toString();

  let raw: unknown;
  try {
    raw = await serverApi<unknown>(url, { cookie });
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

  return parseListPage(raw);
}
