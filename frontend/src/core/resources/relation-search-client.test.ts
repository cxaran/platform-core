import test from "node:test";
import assert from "node:assert/strict";

import {
  fetchRelationItem,
  fetchRelationMeta,
  searchRelationItems,
} from "./relation-search-client.ts";

// relation-search-client delega en browserApi (credentials:"include") -> requestJson ->
// globalThis.fetch. Se mockea fetch y se verifica la URL/parámetros y el parseo.

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function capture(
  t: { mock: { method: typeof import("node:test").mock.method } },
  body: unknown,
  status = 200,
) {
  const captured: { url?: unknown; init?: RequestInit } = {};
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    captured.url = url;
    captured.init = init;
    return jsonResponse(status, body);
  });
  return captured;
}

test("fetchRelationMeta: lee api_path y la búsqueda de la capability del recurso", async (t) => {
  const captured = capture(t, {
    name: "patients",
    label: "Pacientes",
    api_path: "/api/v1/patients",
    view: "table",
    actions: [],
    relations: [],
    list: { search: { enabled: true, min_length: 2 } },
  });
  const meta = await fetchRelationMeta("patients");
  assert.equal(captured.url, "/api/v1/resources/patients");
  assert.equal(captured.init?.credentials, "include");
  assert.deepEqual(meta, {
    apiPath: "/api/v1/patients",
    searchEnabled: true,
    searchMinLength: 2,
  });
});

test("fetchRelationMeta: sin min_length declarado usa 1 por defecto", async (t) => {
  capture(t, {
    name: "doctors",
    label: "Médicos",
    api_path: "/api/v1/doctors",
    view: "table",
    actions: [],
    relations: [],
    list: { search: { enabled: true } },
  });
  const meta = await fetchRelationMeta("doctors");
  assert.equal(meta.searchMinLength, 1);
});

test("searchRelationItems: arma q/limit/offset y devuelve items", async (t) => {
  const captured = capture(t, { items: [{ id: "p-1", full_name: "Ana" }] });
  const items = await searchRelationItems("/api/v1/patients", "  Ana  ", 5);
  assert.equal(captured.url, "/api/v1/patients?q=Ana&limit=5&offset=0");
  assert.deepEqual(items, [{ id: "p-1", full_name: "Ana" }]);
});

test("searchRelationItems: respuesta sin items -> arreglo vacío", async (t) => {
  capture(t, {});
  const items = await searchRelationItems("/api/v1/patients", "Ana");
  assert.deepEqual(items, []);
});

test("fetchRelationItem: GET por id; null si falla (p. ej. 404)", async (t) => {
  const captured = capture(t, { id: "p-1", full_name: "Ana" });
  const item = await fetchRelationItem("/api/v1/patients", "p-1");
  assert.equal(captured.url, "/api/v1/patients/p-1");
  assert.deepEqual(item, { id: "p-1", full_name: "Ana" });

  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(404, { code: "not_found", message: "No existe" }),
  );
  assert.equal(await fetchRelationItem("/api/v1/patients", "missing"), null);
});
