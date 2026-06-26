import test from "node:test";
import assert from "node:assert/strict";

import { ApiRequestError } from "../api/api-error.ts";
import {
  GENERIC_AUTH_ERROR,
  RATE_LIMITED_MESSAGE,
  mapAuthFieldErrors,
  publicAuthGeneralError,
} from "./public-auth.ts";

test("publicAuthGeneralError shows safe message for 429", () => {
  const error = new ApiRequestError(429, { code: "rate_limited", message: "x" });
  assert.equal(publicAuthGeneralError(error), RATE_LIMITED_MESSAGE);
});

test("publicAuthGeneralError never leaks internal detail", () => {
  const error = new ApiRequestError(500, { code: "boom", message: "stack trace secret" });
  const message = publicAuthGeneralError(error);
  assert.equal(message, GENERIC_AUTH_ERROR);
  assert.equal(message.includes("secret"), false);
});

test("mapAuthFieldErrors maps only declared fields", () => {
  const error = new ApiRequestError(422, {
    code: "validation_error",
    message: "invalid",
    errors: [
      { field: "body.password", message: "Contraseña inválida" },
      { field: "body.token", message: "token leaked detail" },
    ],
  });
  const parsed = mapAuthFieldErrors(error, new Set(["password"]));
  assert.deepEqual(parsed.fields.password, ["Contraseña inválida"]);
  assert.equal("token" in parsed.fields, false);
  assert.equal(parsed.general?.includes("token leaked detail"), false);
});

test("mapAuthFieldErrors falls back to safe general for non-422", () => {
  const error = new ApiRequestError(429, { code: "rate_limited", message: "x" });
  const parsed = mapAuthFieldErrors(error, new Set(["password"]));
  assert.equal(parsed.general, RATE_LIMITED_MESSAGE);
  assert.deepEqual(parsed.fields, {});
});
