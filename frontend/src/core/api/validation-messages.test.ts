import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeApiError } from "./api-error";
import { validationMessage } from "./validation-messages";

test("missing se traduce al mensaje obligatorio", () => {
  assert.equal(
    validationMessage({ message: "Field required", type: "missing" }),
    "Este campo es obligatorio.",
  );
});

test("string_too_short usa el mínimo declarado en ctx", () => {
  assert.equal(
    validationMessage({
      message: "x",
      type: "string_too_short",
      ctx: { min_length: 4 },
    }),
    "Debe tener al menos 4 caracteres.",
  );
});

test("string_too_long usa el máximo declarado en ctx", () => {
  assert.equal(
    validationMessage({
      message: "x",
      type: "string_too_long",
      ctx: { max_length: 50 },
    }),
    "Debe tener como máximo 50 caracteres.",
  );
});

test("constraints numéricas usan el límite declarado", () => {
  assert.equal(
    validationMessage({ message: "x", type: "greater_than_equal", ctx: { ge: 1 } }),
    "Debe ser mayor o igual a 1.",
  );
  assert.equal(
    validationMessage({ message: "x", type: "less_than_equal", ctx: { le: 500 } }),
    "Debe ser menor o igual a 500.",
  );
});

test("value_error de dominio (ya en español) se limpia y preserva", () => {
  assert.equal(
    validationMessage({
      message: "Value error, Las contraseñas no coinciden",
      type: "value_error",
    }),
    "Las contraseñas no coinciden",
  );
});

test("value_error de email de Pydantic se localiza", () => {
  assert.equal(
    validationMessage({
      message: "value is not a valid email address: bad",
      type: "value_error",
    }),
    "Correo electrónico inválido.",
  );
});

test("tipo desconocido usa el mensaje general sin filtrar texto interno", () => {
  const message = validationMessage({
    message: "internal english detail",
    type: "something_internal",
  });
  assert.equal(message, "El valor ingresado no es válido.");
});

test("item sin type conserva el mensaje de negocio del backend", () => {
  assert.equal(
    validationMessage({ message: "No se permite ordenar por 'bad_field'." }),
    "No se permite ordenar por 'bad_field'.",
  );
});

test("normalizeApiError traduce los items de toda respuesta de error", () => {
  const body = normalizeApiError(422, {
    code: "validation_error",
    message: "Parámetros inválidos",
    errors: [
      { field: "name", message: "Field required", type: "missing" },
      { field: "sort", message: "Orden inválido." },
    ],
  });

  assert.equal(body.errors?.[0]?.message, "Este campo es obligatorio.");
  assert.equal(body.errors?.[1]?.message, "Orden inválido.");
});

test("normalizeApiError tolera errores ausentes", () => {
  const body = normalizeApiError(409, { code: "conflict", message: "Ya existe." });
  assert.equal(body.errors, undefined);
});
