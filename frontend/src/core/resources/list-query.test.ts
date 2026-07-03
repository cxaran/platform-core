import test from "node:test";
import assert from "node:assert/strict";

import type {
  ResourceFieldCapability,
  ResourceListCapability,
} from "@/core/api/contracts";

import {
  buildFilterableControls,
  buildListHref,
  buildListSearchParams,
  buildPageHref,
  buildSortHref,
  parseListQuery,
  parseSearchField,
  type ResourceListQuery,
} from "./list-query.ts";

function fieldCap(
  name: string,
  overrides: Partial<ResourceFieldCapability> = {},
): ResourceFieldCapability {
  return {
    name,
    label: name,
    type: "string",
    visible_in_list: true,
    sortable: false,
    searchable: false,
    filter_operators: [],
    ...overrides,
  };
}

function listCap(overrides: Partial<ResourceListCapability> = {}): ResourceListCapability {
  return {
    fields: [
      fieldCap("full_name", { sortable: true }),
      fieldCap("created_at", { sortable: true }),
      fieldCap("status", { sortable: false }),
    ],
    filterable_fields: [],
    pagination: { default_limit: 20, max_limit: 100 },
    search: { enabled: true, min_length: 2, max_length: 50 },
    sort: { default_sort: null, fixed_server_order: false, max_terms: 1, max_length: 40 },
    ...overrides,
  };
}

const CONTROLS = buildFilterableControls(listCap());

function parse(
  params: Record<string, string | string[] | undefined>,
  list: ResourceListCapability = listCap(),
): ResourceListQuery {
  return parseListQuery(params, list, buildFilterableControls(list));
}

function baseQuery(overrides: Partial<ResourceListQuery> = {}): ResourceListQuery {
  return { limit: 20, offset: 0, filters: {}, ...overrides };
}

// --- limit (parseLimit) ---

test("parseListQuery: limit ausente o inválido cae al default", () => {
  assert.equal(parse({}).limit, 20);
  assert.equal(parse({ limit: "abc" }).limit, 20);
  assert.equal(parse({ limit: "1.5" }).limit, 20);
  assert.equal(parse({ limit: "" }).limit, 20);
});

test("parseListQuery: limit se acota a [1, max_limit]", () => {
  assert.equal(parse({ limit: "0" }).limit, 1);
  assert.equal(parse({ limit: "-3" }).limit, 1);
  assert.equal(parse({ limit: "9999" }).limit, 100);
  assert.equal(parse({ limit: "37" }).limit, 37);
});

// --- offset (parseOffset) ---

test("parseListQuery: offset inválido o negativo => 0; válido se respeta", () => {
  assert.equal(parse({}).offset, 0);
  assert.equal(parse({ offset: "abc" }).offset, 0);
  assert.equal(parse({ offset: "-5" }).offset, 0);
  assert.equal(parse({ offset: "40" }).offset, 40);
});

// --- q (parseQuery) ---

test("parseListQuery: q válido se recorta (trim); por debajo del mínimo => undefined", () => {
  assert.equal(parse({ q: "  ana  " }).q, "ana");
  assert.equal(parse({ q: "a" }).q, undefined); // 1 < min(2)
  assert.equal(parse({ q: "   " }).q, undefined); // vacío tras trim
});

test("parseListQuery: q deshabilitado por la capability => undefined", () => {
  const disabled = listCap({ search: { enabled: false, min_length: 2, max_length: 50 } });
  assert.equal(parse({ q: "ana" }, disabled).q, undefined);
});

test("parseListQuery: q por encima de max_length => undefined", () => {
  const short = listCap({ search: { enabled: true, min_length: 2, max_length: 4 } });
  assert.equal(parse({ q: "abcd" }, short).q, "abcd");
  assert.equal(parse({ q: "abcde" }, short).q, undefined);
});

// --- sort (parseSort) ---

test("parseListQuery: sort asc y desc sobre campo sortable", () => {
  assert.deepEqual(parse({ sort: "full_name" }).sort, { field: "full_name", direction: "asc" });
  assert.deepEqual(parse({ sort: "-created_at" }).sort, {
    field: "created_at",
    direction: "desc",
  });
});

test("parseListQuery: sort sobre campo no sortable o inexistente => undefined", () => {
  assert.equal(parse({ sort: "status" }).sort, undefined); // status.sortable === false
  assert.equal(parse({ sort: "desconocido" }).sort, undefined);
});

test("parseListQuery: sort con coma, vacío, solo '-' o demasiado largo => undefined", () => {
  assert.equal(parse({ sort: "full_name,created_at" }).sort, undefined);
  assert.equal(parse({ sort: "" }).sort, undefined);
  assert.equal(parse({ sort: "-" }).sort, undefined); // field vacío
  const tight = listCap({
    sort: { default_sort: null, fixed_server_order: false, max_terms: 1, max_length: 3 },
  });
  assert.equal(parse({ sort: "full_name" }, tight).sort, undefined); // 9 > max_length 3
});

// --- composición + filtros vacíos ---

test("parseListQuery: combina q/sort/limit/offset y filtros vacíos sin filterable_fields", () => {
  const result = parse({ q: "ana", sort: "-full_name", limit: "10", offset: "20" });
  assert.deepEqual(result, {
    q: "ana",
    sort: { field: "full_name", direction: "desc" },
    limit: 10,
    offset: 20,
    filters: {},
  });
});

// --- parseSearchField ---

test("parseSearchField: marca tooShort solo si está habilitado y por debajo del mínimo", () => {
  assert.deepEqual(parseSearchField({ q: "a" }, listCap()), { value: "a", tooShort: true });
  assert.deepEqual(parseSearchField({ q: "ana" }, listCap()), { value: "ana", tooShort: false });
  assert.deepEqual(parseSearchField({}, listCap()), { value: "", tooShort: false });
});

test("parseSearchField: con búsqueda deshabilitada nunca es tooShort y conserva el valor crudo", () => {
  const disabled = listCap({ search: { enabled: false, min_length: 2, max_length: 50 } });
  assert.deepEqual(parseSearchField({ q: "a" }, disabled), { value: "a", tooShort: false });
});

// --- buildListSearchParams / sortToParam ---

test("buildListSearchParams: orden determinista q,sort,limit,offset", () => {
  const params = buildListSearchParams(
    baseQuery({ q: "ana", sort: { field: "full_name", direction: "desc" }, offset: 40 }),
    CONTROLS,
  );
  assert.equal(params.toString(), "q=ana&sort=-full_name&limit=20&offset=40");
});

test("buildListSearchParams: omite q y sort si no están; limit/offset siempre presentes", () => {
  const params = buildListSearchParams(baseQuery(), CONTROLS);
  assert.equal(params.get("q"), null);
  assert.equal(params.get("sort"), null);
  assert.equal(params.get("limit"), "20");
  assert.equal(params.get("offset"), "0");
});

test("buildListSearchParams: sort ascendente se serializa sin prefijo '-'", () => {
  const params = buildListSearchParams(
    baseQuery({ sort: { field: "created_at", direction: "asc" } }),
    CONTROLS,
  );
  assert.equal(params.get("sort"), "created_at");
});

test("buildListHref: concatena basePath y query string", () => {
  const href = buildListHref("/pacientes", baseQuery({ offset: 20 }), CONTROLS);
  assert.equal(href, "/pacientes?limit=20&offset=20");
});

// --- buildSortHref (ciclo asc -> desc -> sin sort) ---

test("buildSortHref: sin sort o campo distinto => asc y resetea offset", () => {
  const href = buildSortHref("/p", baseQuery({ offset: 60 }), CONTROLS, "created_at");
  assert.equal(href, "/p?sort=created_at&limit=20&offset=0");
});

test("buildSortHref: mismo campo asc => desc", () => {
  const href = buildSortHref(
    "/p",
    baseQuery({ sort: { field: "full_name", direction: "asc" }, offset: 60 }),
    CONTROLS,
    "full_name",
  );
  assert.equal(href, "/p?sort=-full_name&limit=20&offset=0");
});

test("buildSortHref: mismo campo desc => quita el sort", () => {
  const href = buildSortHref(
    "/p",
    baseQuery({ sort: { field: "full_name", direction: "desc" } }),
    CONTROLS,
    "full_name",
  );
  assert.equal(href, "/p?limit=20&offset=0");
});

// --- buildPageHref ---

test("buildPageHref: fija el offset (acotado a >= 0) y preserva q/sort/limit", () => {
  const query = baseQuery({ q: "ana", sort: { field: "full_name", direction: "asc" }, limit: 10 });
  assert.equal(
    buildPageHref("/p", query, CONTROLS, 30),
    "/p?q=ana&sort=full_name&limit=10&offset=30",
  );
  // offset negativo se acota a 0.
  assert.equal(
    buildPageHref("/p", query, CONTROLS, -5),
    "/p?q=ana&sort=full_name&limit=10&offset=0",
  );
});
