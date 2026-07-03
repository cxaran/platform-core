import test from "node:test";
import assert from "node:assert/strict";

import { ApiRequestError } from "@/core/api/api-error";

import {
  completeRegistration,
  requestPasswordReset,
  requestRegistration,
  resetPassword,
  unlockAccount,
} from "./public-auth-client.ts";

// public-auth-client delega en browserApi (credentials:"include") -> requestJson ->
// globalThis.fetch. Se mockea fetch y se verifica method/path/body/credentials y la
// propagacion de errores. (requestJson en si ya esta cubierto en request.test.ts.)

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("requestRegistration: POST al endpoint con body {email} y credentials:include", async (t) => {
  let captured: { url: unknown; init: RequestInit } | undefined;
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    captured = { url, init };
    return jsonResponse(202, { ok: true });
  });

  const result = await requestRegistration("medico@ejemplo.com");
  assert.deepEqual(result, { ok: true });
  assert.ok(captured);
  assert.equal(captured.url, "/api/v1/auth/register/request");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.credentials, "include");
  assert.equal(captured.init.body, JSON.stringify({ email: "medico@ejemplo.com" }));
  assert.equal(new Headers(captured.init.headers).get("content-type"), "application/json");
});

test("completeRegistration: POST .../register/complete con el payload exacto", async (t) => {
  let captured: { url: unknown; init: RequestInit } | undefined;
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    captured = { url, init };
    return jsonResponse(201, {});
  });

  const payload = {
    first_name: "Ana",
    last_name: "López",
    email: "ana@ejemplo.com",
    token: "tok-123",
    password: "secret-123",
    confirm_password: "secret-123",
  };
  await completeRegistration(payload);
  assert.ok(captured);
  assert.equal(captured.url, "/api/v1/auth/register/complete");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.body, JSON.stringify(payload));
});

test("requestPasswordReset: POST .../password/forgot con {email}", async (t) => {
  let captured: { url: unknown; init: RequestInit } | undefined;
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    captured = { url, init };
    return jsonResponse(202, {});
  });
  await requestPasswordReset("medico@ejemplo.com");
  assert.ok(captured);
  assert.equal(captured.url, "/api/v1/auth/password/forgot");
  assert.equal(captured.init.body, JSON.stringify({ email: "medico@ejemplo.com" }));
});

test("resetPassword: POST .../password/reset con el payload exacto", async (t) => {
  let captured: { url: unknown; init: RequestInit } | undefined;
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    captured = { url, init };
    return jsonResponse(200, {});
  });
  const payload = {
    email: "ana@ejemplo.com",
    token: "tok-123",
    password: "nueva-123",
    confirm_password: "nueva-123",
  };
  await resetPassword(payload);
  assert.ok(captured);
  assert.equal(captured.url, "/api/v1/auth/password/reset");
  assert.equal(captured.init.body, JSON.stringify(payload));
});

test("unlockAccount: POST .../auth/unlock con body {token} y credentials:include", async (t) => {
  let captured: { url: unknown; init: RequestInit } | undefined;
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    captured = { url, init };
    return jsonResponse(200, { message: "Cuenta desbloqueada correctamente" });
  });
  await unlockAccount("tok-desbloqueo");
  assert.ok(captured);
  assert.equal(captured.url, "/api/v1/auth/unlock");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.credentials, "include");
  assert.equal(captured.init.body, JSON.stringify({ token: "tok-desbloqueo" }));
});

test("public-auth client: un 4xx se propaga como ApiRequestError normalizado", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(422, { code: "validation_error", message: "Datos inválidos" }),
  );
  await assert.rejects(
    () =>
      completeRegistration({
        first_name: "Ana",
        last_name: "López",
        email: "ana@ejemplo.com",
        token: "tok-123",
        password: "x",
        confirm_password: "y",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 422);
      assert.equal(error.body.code, "validation_error");
      return true;
    },
  );
});
