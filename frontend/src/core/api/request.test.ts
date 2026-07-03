import test from "node:test";
import assert from "node:assert/strict";

import { requestJson } from "./request.ts";
import { ApiRequestError } from "./api-error.ts";

// requestJson es el seam de red real que usan todos los clients (browserApi/serverApi)
// y, por tanto, executeAction (executeAction -> browserApi -> requestJson; browserApi
// sólo añade credentials:"include"). Se mockea globalThis.fetch, que es el único punto
// de E/S. NOTA (ver report): resource-action-client.ts no es cargable por node --test
// porque browser-client.ts importa el tipo ApiRequestInit como valor; por eso la
// caracterización fiel del comportamiento de error vive aquí, sobre requestJson.

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// --- éxito ---

test("requestJson: 200 con JSON devuelve el payload parseado", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(200, { id: "p1", ok: true }),
  );
  const result = await requestJson<{ id: string; ok: boolean }>("/api/v1/x", { method: "GET" });
  assert.deepEqual(result, { id: "p1", ok: true });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("requestJson: respuesta sin cuerpo JSON (204) devuelve null", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 204 }));
  const result = await requestJson("/api/v1/x", { method: "DELETE" });
  assert.equal(result, null);
});

// --- construcción del request ---

test("requestJson: serializa body objeto como JSON y fija content-type; fixed_body {} -> '{}'", async (t) => {
  let captured: { url: unknown; init: RequestInit } | undefined;
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    captured = { url, init };
    return jsonResponse(200, {});
  });
  await requestJson("/api/v1/x/archive", { method: "POST", body: {} });
  assert.ok(captured);
  assert.equal(captured.url, "/api/v1/x/archive");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.body, "{}"); // fixed_body vacío serializa a "{}", no undefined
  assert.equal(new Headers(captured.init.headers).get("content-type"), "application/json");
});

test("requestJson: FormData no se serializa ni fuerza content-type", async (t) => {
  let captured: RequestInit | undefined;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    captured = init;
    return jsonResponse(201, { id: "doc-1" });
  });
  const form = new FormData();
  form.set("file", "binario");
  await requestJson("/api/v1/clinical-documents", { method: "POST", body: form });
  assert.ok(captured);
  assert.ok(captured.body instanceof FormData);
  assert.equal(new Headers(captured.headers).get("content-type"), null);
});

// --- error 4xx/5xx: SIEMPRE lanza ApiRequestError (no se traga) ---

for (const status of [400, 401, 403, 404, 409, 422, 500]) {
  test(`requestJson: ${status} con envelope lanza ApiRequestError con code/message del body`, async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      jsonResponse(status, { code: "domain_error", message: "Mensaje de negocio" }),
    );
    await assert.rejects(
      () => requestJson("/api/v1/x", { method: "POST", body: {} }),
      (error: unknown) => {
        assert.ok(error instanceof ApiRequestError);
        assert.equal(error.status, status);
        assert.equal(error.body.code, "domain_error");
        assert.equal(error.body.message, "Mensaje de negocio");
        assert.equal(error.message, "Mensaje de negocio");
        return true;
      },
    );
  });
}

test("requestJson: error sin JSON cae al envelope http_<status> seguro", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response("<html>boom</html>", { status: 500, headers: { "content-type": "text/html" } }),
  );
  await assert.rejects(
    () => requestJson("/api/v1/x"),
    (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 500);
      assert.equal(error.body.code, "http_500");
      assert.equal(error.body.message, "No se pudo procesar la respuesta del servidor");
      return true;
    },
  );
});

test("requestJson: fallo de red lanza ApiRequestError(0, network_error)", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(
    () => requestJson("/api/v1/x"),
    (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 0);
      assert.equal(error.body.code, "network_error");
      return true;
    },
  );
});
