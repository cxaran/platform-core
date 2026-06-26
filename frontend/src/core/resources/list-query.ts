import type { ResourceListCapability } from "@/core/api/contracts";
import {
  appendFilterableParams,
  buildFilterableControls,
  parseFilterableValues,
  type FilterableControls,
} from "@/core/resources/filterable";

export type SortDirection = "asc" | "desc";

export type ResourceListQuery = {
  q?: string;
  sort?: {
    field: string;
    direction: SortDirection;
  };
  limit: number;
  offset: number;
  // Filtros activos validados, keyed por el nombre de parámetro real del backend.
  filters: Record<string, string>;
};

// Re-export para los callers (página + cliente de lista) que construyen los controles.
export { buildFilterableControls };
export type { FilterableControls };

type RawSearchParams = Record<string, string | string[] | undefined>;

function singleParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseInteger(raw: string | undefined): number | null {
  if (raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return null;
  }
  return Number.parseInt(trimmed, 10);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sortableFieldNames(list: ResourceListCapability): Set<string> {
  return new Set(list.fields.filter((field) => field.sortable).map((field) => field.name));
}

function parseLimit(raw: string | undefined, list: ResourceListCapability): number {
  const { default_limit, max_limit } = list.pagination;
  const parsed = parseInteger(raw);
  if (parsed === null) {
    return default_limit;
  }
  return clamp(parsed, 1, max_limit);
}

function parseOffset(raw: string | undefined): number {
  const parsed = parseInteger(raw);
  if (parsed === null || parsed < 0) {
    return 0;
  }
  return parsed;
}

function parseQuery(raw: string | undefined, list: ResourceListCapability): string | undefined {
  if (raw === undefined || !list.search.enabled) {
    return undefined;
  }
  const trimmed = raw.trim();
  const min = list.search.min_length ?? 0;
  const max = list.search.max_length ?? Number.POSITIVE_INFINITY;
  if (trimmed.length < Math.max(min, 1) || trimmed.length > max) {
    return undefined;
  }
  return trimmed;
}

function parseSort(
  raw: string | undefined,
  list: ResourceListCapability,
): ResourceListQuery["sort"] {
  if (raw === undefined) {
    return undefined;
  }
  const term = raw.trim();
  // Solo un término en esta primera UI: cualquier coma invalida todo el sort.
  if (term === "" || term.includes(",") || term.length > list.sort.max_length) {
    return undefined;
  }
  const direction: SortDirection = term.startsWith("-") ? "desc" : "asc";
  const field = direction === "desc" ? term.slice(1) : term;
  if (field === "" || !sortableFieldNames(list).has(field)) {
    return undefined;
  }
  return { field, direction };
}

/** Estado de lista canónico y seguro, validado contra la capability y sus filtros. */
export function parseListQuery(
  searchParams: RawSearchParams,
  list: ResourceListCapability,
  controls: FilterableControls,
): ResourceListQuery {
  return {
    q: parseQuery(singleParam(searchParams.q), list),
    sort: parseSort(singleParam(searchParams.sort), list),
    limit: parseLimit(singleParam(searchParams.limit), list),
    offset: parseOffset(singleParam(searchParams.offset)),
    filters: parseFilterableValues(searchParams, controls),
  };
}

/** Texto crudo de búsqueda para prellenar el form + si está por debajo del mínimo. */
export function parseSearchField(
  searchParams: RawSearchParams,
  list: ResourceListCapability,
): { value: string; tooShort: boolean } {
  const raw = singleParam(searchParams.q) ?? "";
  const trimmed = raw.trim();
  const min = list.search.min_length ?? 0;
  const tooShort = list.search.enabled && trimmed.length > 0 && trimmed.length < Math.max(min, 1);
  return { value: raw, tooShort };
}

function sortToParam(sort: NonNullable<ResourceListQuery["sort"]>): string {
  return `${sort.direction === "desc" ? "-" : ""}${sort.field}`;
}

/**
 * Reconstruye los parámetros solo desde el estado validado. Orden determinista:
 * q, sort, limit, offset, y luego los filtros activos por su nombre de parámetro
 * real (allowlist en ``controls.paramNames``; jamás se itera ``query.filters``).
 */
export function buildListSearchParams(
  query: ResourceListQuery,
  controls: FilterableControls,
): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q !== undefined) {
    params.set("q", query.q);
  }
  if (query.sort !== undefined) {
    params.set("sort", sortToParam(query.sort));
  }
  // limit y offset explícitos siempre: enlaces/forms deterministas.
  params.set("limit", String(query.limit));
  params.set("offset", String(query.offset));
  appendFilterableParams(params, query.filters, controls);
  return params;
}

export function buildListHref(
  basePath: string,
  query: ResourceListQuery,
  controls: FilterableControls,
): string {
  return `${basePath}?${buildListSearchParams(query, controls).toString()}`;
}

/**
 * Href para alternar el sort de una columna (un solo término):
 * sin sort / otro campo → asc; mismo asc → desc; mismo desc → quitar sort.
 * Siempre resetea offset y preserva q, limit y filtros válidos.
 */
export function buildSortHref(
  basePath: string,
  query: ResourceListQuery,
  controls: FilterableControls,
  fieldName: string,
): string {
  let nextSort: ResourceListQuery["sort"];
  if (!query.sort || query.sort.field !== fieldName) {
    nextSort = { field: fieldName, direction: "asc" };
  } else if (query.sort.direction === "asc") {
    nextSort = { field: fieldName, direction: "desc" };
  } else {
    nextSort = undefined;
  }
  return buildListHref(basePath, { ...query, sort: nextSort, offset: 0 }, controls);
}

/** Href para una página por offset, preservando q, sort, limit y filtros. */
export function buildPageHref(
  basePath: string,
  query: ResourceListQuery,
  controls: FilterableControls,
  nextOffset: number,
): string {
  return buildListHref(basePath, { ...query, offset: Math.max(0, nextOffset) }, controls);
}
