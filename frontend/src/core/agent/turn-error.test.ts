import assert from "node:assert/strict";
import { test } from "node:test";

import {
  OPENCODE_ZEN_INFERENCE_401_MESSAGE,
  turnFailureMessage,
} from "@/core/agent/turn-error";

test("opencode Zen + 401 tras discovery -> mensaje amistoso en español", () => {
  const error = {
    code: "PROVIDER_REQUEST_FAILED",
    message: "Opencode chat completion failed with status 401",
    details: { providerStatus: 401, providerError: "unauthorized" },
  };
  assert.equal(turnFailureMessage(error, "opencode_zen"), OPENCODE_ZEN_INFERENCE_401_MESSAGE);
});

test("opencode Zen con OTRO status (no 401) conserva su mensaje original", () => {
  const error = {
    code: "PROVIDER_REQUEST_FAILED",
    message: "Opencode chat completion failed with status 400: bad field",
    details: { providerStatus: 400 },
  };
  assert.equal(
    turnFailureMessage(error, "opencode_zen"),
    "No se pudo completar el turno: Opencode chat completion failed with status 400: bad field",
  );
});

test("opencode Go con 401 NO recibe el mensaje de Zen (sólo Zen)", () => {
  const error = {
    code: "PROVIDER_REQUEST_FAILED",
    message: "Opencode chat completion failed with status 401",
    details: { providerStatus: 401 },
  };
  const out = turnFailureMessage(error, "opencode_go");
  assert.notEqual(out, OPENCODE_ZEN_INFERENCE_401_MESSAGE);
  assert.match(out, /^No se pudo completar el turno: /);
});

test("401 en un protocolo no-opencode conserva su mensaje (no se traga)", () => {
  const error = {
    code: "PROVIDER_REQUEST_FAILED",
    message: "Some other provider failed",
    details: { providerStatus: 401 },
  };
  assert.equal(
    turnFailureMessage(error, "openai_chat_completions"),
    "No se pudo completar el turno: Some other provider failed",
  );
});

test("opencode Zen sin details (sin providerStatus) conserva su mensaje", () => {
  const error = { code: "PROVIDER_REQUEST_FAILED", message: "fallo genérico" };
  assert.equal(
    turnFailureMessage(error, "opencode_zen"),
    "No se pudo completar el turno: fallo genérico",
  );
});

test("error nulo o sin protocolo: prefijo genérico, sin lanzar", () => {
  assert.equal(turnFailureMessage(null), "No se pudo completar el turno: error");
  assert.equal(turnFailureMessage(undefined, null), "No se pudo completar el turno: error");
  assert.equal(
    turnFailureMessage({ code: "X", message: "" }),
    "No se pudo completar el turno: X",
  );
});
