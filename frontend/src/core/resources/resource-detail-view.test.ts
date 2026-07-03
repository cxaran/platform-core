import assert from "node:assert/strict";
import { test } from "node:test";

import type { ResourceCapability } from "@/core/api/contracts";
import {
  displayFields,
  fieldDisplayKind,
  formatDisplayValue,
  isBlankDisplay,
  type DisplayField,
} from "@/core/resources/resource-detail-view";

function field(overrides: Partial<DisplayField>): DisplayField {
  return {
    name: "campo",
    label: "Campo",
    description: null,
    type: "string",
    widget: "text",
    options: null,
    ...overrides,
  };
}

test("fieldDisplayKind: cada widget mapea a un modo de lectura conocido (ninguno editable)", () => {
  const cases: Array<[DisplayField["widget"], string]> = [
    ["text", "text"],
    ["email", "text"],
    ["password", "text"],
    ["textarea", "text"],
    ["switch", "boolean"],
    ["select", "select"],
    ["multiselect", "select"],
    ["number", "number"],
    ["date", "date"],
    ["daterange", "date"],
    ["datetime", "datetime"],
    ["time", "time"],
  ];
  const known = new Set([
    "text",
    "boolean",
    "number",
    "date",
    "datetime",
    "time",
    "select",
    "relation",
  ]);
  for (const [widget, expected] of cases) {
    const kind = fieldDisplayKind(field({ name: "x", widget }));
    assert.equal(kind, expected, `widget ${widget}`);
    assert.ok(known.has(kind));
  }
});

test("fieldDisplayKind: sin widget se deriva del type declarado (fuente lista)", () => {
  assert.equal(fieldDisplayKind(field({ widget: null, type: "boolean" })), "boolean");
  assert.equal(fieldDisplayKind(field({ widget: null, type: "integer" })), "number");
  assert.equal(fieldDisplayKind(field({ widget: null, type: "decimal" })), "number");
  assert.equal(fieldDisplayKind(field({ widget: null, type: "datetime" })), "datetime");
  assert.equal(fieldDisplayKind(field({ widget: null, type: "enum" })), "select");
  assert.equal(fieldDisplayKind(field({ widget: null, type: "string" })), "text");
});

test("fieldDisplayKind: campo FK (nombre resuelve a recurso) se pinta como relación", () => {
  assert.equal(fieldDisplayKind(field({ name: "user_id", widget: "text" })), "relation");
  // FK también detectable cuando viene de la lista (sin widget) con type uuid.
  assert.equal(fieldDisplayKind(field({ name: "user_id", widget: null, type: "uuid" })), "relation");
  // Un text normal NO es relación.
  assert.equal(fieldDisplayKind(field({ name: "full_name", widget: "text" })), "text");
});

test("formatDisplayValue: cada tipo de widget rinde su valor de lectura", () => {
  assert.equal(formatDisplayValue(field({ widget: "text" }), "Hola"), "Hola");
  assert.equal(formatDisplayValue(field({ widget: "email" }), "a@b.com"), "a@b.com");
  assert.equal(formatDisplayValue(field({ widget: "textarea" }), "línea"), "línea");
  assert.equal(formatDisplayValue(field({ widget: "switch" }), true), "Sí");
  assert.equal(formatDisplayValue(field({ widget: "switch" }), false), "No");
  assert.equal(formatDisplayValue(field({ widget: "number" }), 36.6), "36.6");
  assert.equal(formatDisplayValue(field({ widget: "date" }), "1990-05-02"), "1990-05-02");
  // El detalle puede traer un ISO completo en un campo date: se recorta sin desplazar el día.
  assert.equal(formatDisplayValue(field({ widget: "date" }), "1990-05-02T00:00:00Z"), "1990-05-02");
  assert.equal(
    formatDisplayValue(field({ widget: "datetime" }), "2026-06-28T14:30:00Z"),
    "2026-06-28 14:30 UTC",
  );
  assert.equal(formatDisplayValue(field({ widget: "time" }), "08:15:00"), "08:15");
});

test("isBlankDisplay: detecta vacíos para omitir el campo (sin dejar el '—')", () => {
  // El guion de "sin dato" y las cadenas vacías se consideran en blanco.
  assert.equal(isBlankDisplay(formatDisplayValue(field({ widget: "text" }), null)), true);
  assert.equal(isBlankDisplay(formatDisplayValue(field({ widget: "text" }), undefined)), true);
  assert.equal(isBlankDisplay(""), true);
  assert.equal(isBlankDisplay("   "), true);
  assert.equal(isBlankDisplay("—"), true);
  // Un valor real NO está en blanco.
  assert.equal(isBlankDisplay(formatDisplayValue(field({ widget: "text" }), "Hola")), false);
  assert.equal(isBlankDisplay(formatDisplayValue(field({ widget: "switch" }), false)), false);
});

test("formatDisplayValue: select muestra la etiqueta de la opción, no el valor crudo", () => {
  const sexo = field({
    name: "sex",
    widget: "select",
    type: "enum",
    options: [
      { value: "male", label: "Masculino" },
      { value: "female", label: "Femenino" },
    ],
  });
  assert.equal(formatDisplayValue(sexo, "female"), "Femenino");
  // Valor sin opción correspondiente: cae al crudo (honesto, no inventa etiqueta).
  assert.equal(formatDisplayValue(sexo, "other"), "other");
});

test("formatDisplayValue: nulos/ausentes muestran guion", () => {
  assert.equal(formatDisplayValue(field({ widget: "text" }), null), "—");
  assert.equal(formatDisplayValue(field({ widget: "text" }), undefined), "—");
  assert.equal(formatDisplayValue(field({ widget: "date" }), ""), "—");
});

test("formatDisplayValue: relación cae a su UUID (la etiqueta se resuelve en el componente)", () => {
  const fk = field({ name: "user_id", widget: "text" });
  assert.equal(formatDisplayValue(fk, "550e8400-e29b-41d4-a716-446655440000"), "550e8400-e29b-41d4-a716-446655440000");
});

test("displayFields: con sólo formulario de actualización rinde esos campos (con widgets)", () => {
  const capability = {
    forms: {
      update: {
        fields: [
          { name: "full_name", label: "Nombre", type: "string", required: true, editable: true, widget: "text" },
          { name: "sex", label: "Sexo", type: "enum", required: true, editable: true, widget: "select", options: [{ value: "male", label: "Masculino" }] },
        ],
      },
    },
    list: { fields: [{ name: "id", label: "ID", type: "uuid" }] },
  } as unknown as ResourceCapability;
  const fields = displayFields(capability);
  assert.equal(fields.length, 2);
  assert.equal(fields[0].name, "full_name");
  assert.equal(fields[1].widget, "select");
  assert.deepEqual(fields[1].options, [{ value: "male", label: "Masculino" }]);
});

test("displayFields: une create ∪ update para mostrar la FK INMUTABLE (que update omite)", () => {
  const capability = {
    forms: {
      // user_id es inmutable: sólo está en creación. Debe verse en el detalle.
      create: {
        fields: [
          { name: "user_id", label: "Usuario", type: "uuid", required: true, editable: true, widget: "text" },
          { name: "title", label: "Nombre", type: "string", required: true, editable: true, widget: "text" },
        ],
      },
      update: {
        fields: [
          { name: "title", label: "Nombre", type: "string", required: true, editable: true, widget: "text" },
          { name: "status", label: "Estado", type: "enum", required: false, editable: true, widget: "select" },
        ],
      },
    },
    list: { fields: [] },
  } as unknown as ResourceCapability;
  const fields = displayFields(capability);
  // Orden: create primero, luego lo que sólo aparece en update; dedup por nombre.
  assert.deepEqual(fields.map((f) => f.name), ["user_id", "title", "status"]);
  // La FK se pinta como relación (etiqueta humana).
  assert.equal(fieldDisplayKind(fields[0]), "relation");
});

test("displayFields: excluye el widget password (sin valor legible en lectura)", () => {
  const capability = {
    forms: {
      create: {
        fields: [
          { name: "email", label: "Correo", type: "email", required: true, editable: true, widget: "email" },
          { name: "password", label: "Contraseña", type: "string", required: true, editable: true, widget: "password" },
        ],
      },
    },
    list: { fields: [] },
  } as unknown as ResourceCapability;
  assert.deepEqual(displayFields(capability).map((f) => f.name), ["email"]);
});

test("displayFields: sin formulario (rol de sólo lectura) cae a los campos de la lista", () => {
  const capability = {
    forms: null,
    list: {
      fields: [
        { name: "full_name", label: "Nombre", type: "string" },
        { name: "born_on", label: "Nacimiento", type: "date" },
      ],
    },
  } as unknown as ResourceCapability;
  const fields = displayFields(capability);
  assert.equal(fields.length, 2);
  assert.equal(fields[0].widget, null);
  // Sin widget, el modo se deriva del type.
  assert.equal(fieldDisplayKind(fields[1]), "date");
});
