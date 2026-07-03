import test from "node:test";
import assert from "node:assert/strict";

import type { ResourceActionCapability } from "@/core/api/contracts";
import { ApiRequestError } from "@/core/api/api-error";

import { executeAction } from "./resource-action-client.ts";

// Cadena completa de executeAction (desbloqueada al corregir el import de tipo en
// browser-client.ts): executeAction -> browserApi (añade credentials:"include") ->
// requestJson -> globalThis.fetch. Se mockea fetch (único seam de E/S).

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fixedBodyAction(
  overrides: Partial<ResourceActionCapability> = {},
): ResourceActionCapability {
  return {
    name: "archive",
    label: "Archivar",
    method: "POST" as const,
    url_template: "/api/v1/clinical-documents/{id}/archive",
    scope: "item" as const,
    danger: false,
    success_behavior: "refresh" as const,
    request: { content_type: "application/json", fixed_body: { reason: "obsoleto" } },
    ...overrides,
  };
}

test("executeAction: resuelve URL desde el placeholder, usa el método y envía credentials:include", async (t) => {
  let captured: { url: unknown; init: RequestInit } | undefined;
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    captured = { url, init };
    return jsonResponse(200, { status: "archived" });
  });

  const result = await executeAction(fixedBodyAction(), "id", "doc-1");

  assert.deepEqual(result, { status: "archived" });
  assert.ok(captured);
  assert.equal(captured.url, "/api/v1/clinical-documents/doc-1/archive");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.credentials, "include");
  assert.equal(captured.init.body, JSON.stringify({ reason: "obsoleto" }));
});

test("executeAction: fixed_body se envía exacto e ignora el payload del usuario", async (t) => {
  let body: unknown;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    body = init.body;
    return jsonResponse(200, {});
  });

  await executeAction(fixedBodyAction(), "id", "doc-1", { reason: "INYECTADO", extra: 1 });
  assert.equal(body, JSON.stringify({ reason: "obsoleto" }));
});

test("executeAction: respuesta de éxito sin cuerpo JSON (204) devuelve null", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 204 }));
  const result = await executeAction(fixedBodyAction({ method: "DELETE" }), "id", "doc-1");
  assert.equal(result, null);
});

test("executeAction: un 4xx se propaga como ApiRequestError con el envelope normalizado", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(409, { code: "clinical_document_state_invalid", message: "Estado inválido" }),
  );

  await assert.rejects(
    () => executeAction(fixedBodyAction(), "id", "doc-1"),
    (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 409);
      assert.equal(error.body.code, "clinical_document_state_invalid");
      assert.equal(error.body.message, "Estado inválido");
      return true;
    },
  );
});

test("executeAction: un 500 se propaga como ApiRequestError (no se traga)", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response("<html>", { status: 500, headers: { "content-type": "text/html" } }),
  );

  await assert.rejects(
    () => executeAction(fixedBodyAction(), "id", "doc-1"),
    (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 500);
      assert.equal(error.body.code, "http_500");
      return true;
    },
  );
});
