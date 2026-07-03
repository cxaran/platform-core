import test from "node:test";
import assert from "node:assert/strict";

import { ApiRequestError } from "@/core/api/api-error";

import { changePassword, logout, updateProfile } from "./account-mutation-client.ts";

// account-mutation-client delega en browserApi (credentials:"include") -> requestJson
// -> globalThis.fetch. Se mockea fetch y se verifica method/path/body/credentials y la
// propagacion de errores. (requestJson en si ya esta cubierto en request.test.ts.)

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("updateProfile: PATCH /api/v1/users/me con el payload y credentials:include", async (t) => {
  let captured: { url: unknown; init: RequestInit } | undefined;
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    captured = { url, init };
    return jsonResponse(200, { id: "u1", name: "Ana" });
  });

  const result = await updateProfile({ name: "Ana", last_name: "López" });
  assert.deepEqual(result, { id: "u1", name: "Ana" });
  assert.ok(captured);
  assert.equal(captured.url, "/api/v1/users/me");
  assert.equal(captured.init.method, "PATCH");
  assert.equal(captured.init.credentials, "include");
  assert.equal(captured.init.body, JSON.stringify({ name: "Ana", last_name: "López" }));
});

test("changePassword: POST /api/v1/users/me/password con el payload exacto", async (t) => {
  let captured: { url: unknown; init: RequestInit } | undefined;
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    captured = { url, init };
    return new Response(null, { status: 204 });
  });

  const payload = {
    current_password: "vieja-123",
    password: "nueva-123",
    confirm_password: "nueva-123",
  };
  await changePassword(payload);
  assert.ok(captured);
  assert.equal(captured.url, "/api/v1/users/me/password");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.body, JSON.stringify(payload));
});

test("logout: POST /api/v1/auth/logout sin body, con credentials:include", async (t) => {
  let captured: { url: unknown; init: RequestInit } | undefined;
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    captured = { url, init };
    return new Response(null, { status: 204 });
  });

  await logout();
  assert.ok(captured);
  assert.equal(captured.url, "/api/v1/auth/logout");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.body, undefined); // sin cuerpo
  assert.equal(captured.init.credentials, "include");
});

test("account-mutation client: un 4xx se propaga como ApiRequestError normalizado", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse(422, { code: "validation_error", message: "Correo inválido" }),
  );
  await assert.rejects(
    () => updateProfile({ email: "no-es-correo" }),
    (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 422);
      assert.equal(error.body.code, "validation_error");
      return true;
    },
  );
});
