import test from "node:test";
import assert from "node:assert/strict";

import type { HttpMethod, ResourceFormCapability } from "@/core/api/contracts";
import { ApiRequestError } from "@/core/api/api-error";

import {
  createResource,
  replaceRelation,
  updateResource,
} from "./resource-mutation-client.ts";

// resource-mutation-client valida la ruta interna (assertInternalApiPath, sincrono) y
// delega en browserApi (credentials:"include") -> requestJson -> globalThis.fetch.
// Se mockea fetch y se verifica method/path/body y el guard de ruta. (requestJson en si
// ya esta cubierto en request.test.ts.)

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function form(overrides: Partial<ResourceFormCapability> = {}): ResourceFormCapability {
  return {
    method: "POST",
    url_template: "/api/v1/patients",
    fields: [],
    transport: "json",
    ...overrides,
  };
}

test("createResource: usa method/url del form, envia el payload y credentials:include", async (t) => {
  let captured: { url: unknown; init: RequestInit } | undefined;
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    captured = { url, init };
    return jsonResponse(201, { id: "p1" });
  });

  const result = await createResource(form(), { full_name: "Ana", sex: "female" });
  assert.deepEqual(result, { id: "p1" });
  assert.ok(captured);
  assert.equal(captured.url, "/api/v1/patients");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.credentials, "include");
  assert.equal(captured.init.body, JSON.stringify({ full_name: "Ana", sex: "female" }));
});

test("updateResource: usa la URL ya resuelta y el método indicado con el payload", async (t) => {
  let captured: { url: unknown; init: RequestInit } | undefined;
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    captured = { url, init };
    return jsonResponse(200, { id: "p1", phone: "811" });
  });

  await updateResource("/api/v1/patients/p1", "PATCH" as HttpMethod, { phone: "811" });
  assert.ok(captured);
  assert.equal(captured.url, "/api/v1/patients/p1");
  assert.equal(captured.init.method, "PATCH");
  assert.equal(captured.init.body, JSON.stringify({ phone: "811" }));
});

test("replaceRelation: envia { [requestField]: values } con la lista completa", async (t) => {
  let captured: { url: unknown; init: RequestInit } | undefined;
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    captured = { url, init };
    return jsonResponse(200, {});
  });

  await replaceRelation("/api/v1/roles/r1/permissions", "PUT" as HttpMethod, "permission_ids", [
    "a",
    "b",
  ]);
  assert.ok(captured);
  assert.equal(captured.url, "/api/v1/roles/r1/permissions");
  assert.equal(captured.init.method, "PUT");
  assert.equal(captured.init.body, JSON.stringify({ permission_ids: ["a", "b"] }));
});

test("assertInternalApiPath: rechaza rutas no internas (sincrono, antes de tocar la red)", () => {
  // No empieza con /api/, esquema absoluto, // inicial, o con query/fragment.
  assert.throws(() => createResource(form({ url_template: "/v1/patients" }), {}));
  assert.throws(() => createResource(form({ url_template: "https://evil.com/api/x" }), {}));
  assert.throws(() => updateResource("//evil.com", "PATCH" as HttpMethod, {}));
  assert.throws(() => updateResource("/api/v1/patients/p1?x=1", "PATCH" as HttpMethod, {}));
  assert.throws(() =>
    replaceRelation("/api/v1/roles/r1#frag", "PUT" as HttpMethod, "ids", []),
  );
});

test("resource-mutation client: un 4xx se propaga como ApiRequestError normalizado", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(409, { code: "resource_conflict", message: "Conflicto" }),
  );
  await assert.rejects(
    () => createResource(form(), { full_name: "Dup" }),
    (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 409);
      assert.equal(error.body.code, "resource_conflict");
      return true;
    },
  );
});
