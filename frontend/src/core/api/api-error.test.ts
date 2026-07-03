import test from "node:test";
import assert from "node:assert/strict";

import type { ApiErrorBody } from "./api-error.ts";
import {
  ApiRequestError,
  isApiErrorBody,
  networkApiError,
  normalizeApiError,
} from "./api-error.ts";

// --- isApiErrorBody (type guard) ---

test("isApiErrorBody: acepta un envelope con code y message string", () => {
  assert.equal(isApiErrorBody({ code: "validation_error", message: "Inválido" }), true);
  // errors es opcional: su presencia no invalida ni se exige.
  assert.equal(
    isApiErrorBody({ code: "x", message: "y", errors: [{ field: "a", message: "b" }] }),
    true,
  );
});

test("isApiErrorBody: rechaza null, undefined y valores no objeto", () => {
  assert.equal(isApiErrorBody(null), false);
  assert.equal(isApiErrorBody(undefined), false);
  assert.equal(isApiErrorBody("error"), false);
  assert.equal(isApiErrorBody(42), false);
  assert.equal(isApiErrorBody(true), false);
});

test("isApiErrorBody: rechaza objeto sin code o sin message, o con tipos erróneos", () => {
  assert.equal(isApiErrorBody({ message: "sin code" }), false);
  assert.equal(isApiErrorBody({ code: "sin_message" }), false);
  assert.equal(isApiErrorBody({ code: 123, message: "code no string" }), false);
  assert.equal(isApiErrorBody({ code: "x", message: 123 }), false);
  assert.equal(isApiErrorBody({}), false);
});

// --- normalizeApiError ---

test("normalizeApiError: deja pasar un envelope válido tal cual (misma referencia)", () => {
  const body: ApiErrorBody = {
    code: "resource_conflict",
    message: "Conflicto",
    errors: [{ field: "curp", message: "duplicada" }],
  };
  const result = normalizeApiError(409, body);
  assert.equal(result, body); // passthrough sin copiar
});

test("normalizeApiError: respuesta no conforme cae a un envelope http_<status> seguro", () => {
  const result = normalizeApiError(500, "<html>boom</html>");
  assert.deepEqual(result, {
    code: "http_500",
    message: "No se pudo procesar la respuesta del servidor",
  });
});

test("normalizeApiError: null/undefined también caen al fallback con el status real", () => {
  assert.equal(normalizeApiError(404, null).code, "http_404");
  assert.equal(normalizeApiError(0, undefined).code, "http_0");
});

// --- networkApiError ---

test("networkApiError: envelope estable de fallo de conexión", () => {
  assert.deepEqual(networkApiError(), {
    code: "network_error",
    message: "No se pudo conectar con el servidor",
  });
});

// --- ApiRequestError ---

test("ApiRequestError: expone status/body y usa el message del body", () => {
  const body: ApiErrorBody = { code: "validation_error", message: "Datos inválidos" };
  const error = new ApiRequestError(422, body);
  assert.ok(error instanceof Error);
  assert.equal(error.name, "ApiRequestError");
  assert.equal(error.message, "Datos inválidos");
  assert.equal(error.status, 422);
  assert.equal(error.body, body);
});
