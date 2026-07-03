import test from "node:test";
import assert from "node:assert/strict";

import type { BootstrapInitializeRequest } from "@/core/api/contracts";
import { ApiRequestError } from "@/core/api/api-error";

import { getBootstrapCatalog, initializeBootstrap } from "./bootstrap-client.ts";

// bootstrap-client delega en browserApi (credentials:"include") -> requestJson ->
// globalThis.fetch. Se verifica la construccion del request (method/path/body/headers/
// cache), incluida la logica de tokenHeaders (trim, vacio -> sin header), y la
// propagacion de errores. (requestJson ya esta cubierto en request.test.ts.)

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("getBootstrapCatalog: GET con X-Bootstrap-Token (recortado), cache no-store y credentials include", async (t) => {
  let captured: { url: unknown; init: RequestInit } | undefined;
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    captured = { url, init };
    return jsonResponse(200, { roles: [] });
  });

  const result = await getBootstrapCatalog("  secret-token  ");
  assert.deepEqual(result, { roles: [] });
  assert.ok(captured);
  assert.equal(captured.url, "/api/v1/bootstrap/catalog");
  assert.equal(captured.init.method, undefined); // GET por defecto (no se fija method)
  assert.equal(captured.init.credentials, "include");
  assert.equal(captured.init.cache, "no-store");
  assert.equal(new Headers(captured.init.headers).get("x-bootstrap-token"), "secret-token");
});

test("getBootstrapCatalog: token vacío o de espacios => sin header X-Bootstrap-Token", async (t) => {
  let captured: { init: RequestInit } | undefined;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    captured = { init };
    return jsonResponse(200, {});
  });
  await getBootstrapCatalog("   ");
  assert.ok(captured);
  assert.equal(new Headers(captured.init.headers).get("x-bootstrap-token"), null);
});

test("initializeBootstrap: POST con body JSON y header de token", async (t) => {
  let captured: { url: unknown; init: RequestInit } | undefined;
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    captured = { url, init };
    return jsonResponse(201, { created: true });
  });

  const payload = {
    user: {
      first_name: "Admin",
      last_name: "Tester",
      email: "admin@ejemplo.com",
      password: "secret-123",
      confirm_password: "secret-123",
    },
  } as unknown as BootstrapInitializeRequest;

  const result = await initializeBootstrap(payload, "tok");
  assert.deepEqual(result, { created: true });
  assert.ok(captured);
  assert.equal(captured.url, "/api/v1/bootstrap/initialize");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.credentials, "include");
  assert.equal(captured.init.body, JSON.stringify(payload));
  assert.equal(new Headers(captured.init.headers).get("x-bootstrap-token"), "tok");
});

test("initializeBootstrap: un 409 se propaga como ApiRequestError normalizado", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(409, { code: "already_initialized", message: "Ya inicializado" }),
  );
  const payload = { user: {} } as unknown as BootstrapInitializeRequest;
  await assert.rejects(
    () => initializeBootstrap(payload, "tok"),
    (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 409);
      assert.equal(error.body.code, "already_initialized");
      return true;
    },
  );
});
