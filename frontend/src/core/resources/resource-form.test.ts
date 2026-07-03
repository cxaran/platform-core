import test from "node:test";
import assert from "node:assert/strict";

import type {
  ResourceFormCapability,
  ResourceFormFieldCapability,
} from "@/core/api/contracts";

import {
  FormContractError,
  assertSupportedCreateForm,
  assertSupportedUpdateForm,
  buildCreatePayload,
  buildMultipartPayload,
  buildUpdatePayload,
} from "./resource-form.ts";

function fileField(
  overrides: Partial<{
    name: string;
    label: string;
    accepted_mime_types: string[];
    max_size_bytes: number;
    required: boolean;
  }> = {},
) {
  return {
    name: "file",
    label: "Archivo",
    accepted_mime_types: ["application/pdf"],
    max_size_bytes: 1000,
    required: true,
    ...overrides,
  };
}

function field(
  name: string,
  widget: ResourceFormFieldCapability["widget"],
  overrides: Partial<ResourceFormFieldCapability> = {},
): ResourceFormFieldCapability {
  return {
    name,
    label: name || "campo",
    type: "string",
    required: false,
    editable: true,
    widget,
    ...overrides,
  };
}

function form(
  method: ResourceFormCapability["method"],
  fields: ResourceFormFieldCapability[],
): ResourceFormCapability {
  return {
    method,
    url_template: "/api/v1/things",
    fields,
    transport: "json",
  };
}

// --- assertSupportedCreateForm ---

test("assertSupportedCreateForm acepta POST con widgets soportados (password, select, date, datetime, number, time)", () => {
  const f = form("POST", [
    field("name", "text"),
    field("email", "email"),
    field("password", "password"),
    field("bio", "textarea"),
    field("active", "switch"),
    field("sex", "select"),
    field("birth_date", "date"),
    field("scheduled_at", "datetime"),
    field("duration_minutes", "number"),
    field("at", "time"),
  ]);
  assert.doesNotThrow(() => assertSupportedCreateForm(f));
});

test("assertSupportedCreateForm rechaza método distinto de POST", () => {
  assert.throws(
    () => assertSupportedCreateForm(form("PATCH", [field("name", "text")])),
    FormContractError,
  );
});

test("assertSupportedCreateForm rechaza widget no soportado", () => {
  // multiselect es un WidgetType válido pero aún no está permitido en formularios (F5+).
  assert.throws(
    () => assertSupportedCreateForm(form("POST", [field("tags", "multiselect")])),
    FormContractError,
  );
});

test("assertSupportedCreateForm rechaza widget ausente (null)", () => {
  assert.throws(
    () => assertSupportedCreateForm(form("POST", [field("name", null)])),
    FormContractError,
  );
});

test("assertSupportedCreateForm rechaza nombre de campo vacío", () => {
  assert.throws(
    () => assertSupportedCreateForm(form("POST", [field("", "text")])),
    FormContractError,
  );
});

test("assertSupportedCreateForm rechaza nombres de campo duplicados", () => {
  assert.throws(
    () =>
      assertSupportedCreateForm(
        form("POST", [field("name", "text"), field("name", "email")]),
      ),
    FormContractError,
  );
});

// --- assertSupportedUpdateForm ---

test("assertSupportedUpdateForm acepta PATCH y PUT con widgets soportados (select, date, datetime, number, time)", () => {
  const fields = [
    field("name", "text"),
    field("email", "email"),
    field("bio", "textarea"),
    field("active", "switch"),
    field("sex", "select"),
    field("birth_date", "date"),
    field("scheduled_at", "datetime"),
    field("duration_minutes", "number"),
    field("at", "time"),
  ];
  assert.doesNotThrow(() => assertSupportedUpdateForm(form("PATCH", fields)));
  assert.doesNotThrow(() => assertSupportedUpdateForm(form("PUT", fields)));
});

test("assertSupportedUpdateForm rechaza método que no sea PATCH/PUT", () => {
  assert.throws(
    () => assertSupportedUpdateForm(form("POST", [field("name", "text")])),
    FormContractError,
  );
});

test("assertSupportedUpdateForm rechaza widget password (soportado en create, no en update)", () => {
  // Diferencia clave entre create y update: el cambio de contraseña tiene su propio
  // contrato/flujo separado, por lo que 'password' no es válido en actualización.
  assert.doesNotThrow(() =>
    assertSupportedCreateForm(form("POST", [field("password", "password")])),
  );
  assert.throws(
    () => assertSupportedUpdateForm(form("PATCH", [field("password", "password")])),
    FormContractError,
  );
});

// --- buildUpdatePayload (allowlist por editable) ---

test("buildUpdatePayload excluye campos no editables (editable === false)", () => {
  const fd = new FormData();
  fd.set("name", "Nuevo");
  fd.set("record_number", "999");
  const payload = buildUpdatePayload(
    [field("name", "text"), field("record_number", "text", { editable: false })],
    fd,
  );
  assert.deepEqual(payload, { name: "Nuevo" });
  assert.equal("record_number" in payload, false);
});

test("buildUpdatePayload mapea switch->boolean, string->string y omite opcional vacío", () => {
  const fd = new FormData();
  fd.set("name", "Ana");
  fd.set("active", "on");
  // 'phone' está declarado y es editable pero ausente del FormData (opcional, vacío) -> se omite.
  const payload = buildUpdatePayload(
    [field("name", "text"), field("active", "switch"), field("phone", "text")],
    fd,
  );
  assert.deepEqual(payload, { name: "Ana", active: true });
  assert.equal("phone" in payload, false);
});

test("buildUpdatePayload conserva '' en un campo requerido vacío", () => {
  const fd = new FormData();
  // 'full_name' requerido pero vacío: se envía '' para que el backend lo valide (no null).
  const payload = buildUpdatePayload([field("full_name", "text", { required: true })], fd);
  assert.deepEqual(payload, { full_name: "" });
});

// --- buildCreatePayload ---

test("buildCreatePayload incluye select/date y omite opcionales vacíos", () => {
  const fd = new FormData();
  fd.set("full_name", "Ana López");
  fd.set("sex", "female");
  fd.set("birth_date", "1990-05-20");
  // 'email' opcional y ausente -> se omite (evita 422 de EmailStr y respeta defaults).
  // 'status' opcional con default no-nullable ausente -> se omite (el backend pone su default).
  const payload = buildCreatePayload(
    [
      field("full_name", "text", { required: true }),
      field("sex", "select", { required: true }),
      field("birth_date", "date", { required: true }),
      field("email", "email"),
      field("status", "select"),
    ],
    fd,
  );
  assert.deepEqual(payload, {
    full_name: "Ana López",
    sex: "female",
    birth_date: "1990-05-20",
  });
  assert.equal("email" in payload, false);
  assert.equal("status" in payload, false);
});

test("buildCreatePayload coacciona number a valor numérico (entero y decimal) y datetime queda literal", () => {
  const fd = new FormData();
  fd.set("duration_minutes", "30");
  fd.set("weight_kg", "70.5");
  fd.set("scheduled_at", "2026-07-01T10:30");
  const payload = buildCreatePayload(
    [
      field("duration_minutes", "number", { required: true }),
      field("weight_kg", "number"),
      field("scheduled_at", "datetime", { required: true }),
    ],
    fd,
  );
  assert.deepEqual(payload, {
    duration_minutes: 30,
    weight_kg: 70.5,
    scheduled_at: "2026-07-01T10:30",
  });
  assert.equal(typeof payload.duration_minutes, "number");
  assert.equal(typeof payload.weight_kg, "number");
});

test("buildCreatePayload: number/datetime opcionales vacíos se omiten (no NaN ni '' ni null)", () => {
  const fd = new FormData();
  const payload = buildCreatePayload(
    [field("weight_kg", "number"), field("measured_at", "datetime")],
    fd,
  );
  assert.deepEqual(payload, {});
});

// --- buildMultipartPayload (carga de archivo) ---

test("buildMultipartPayload arma FormData con archivo, omite opcionales vacíos y serializa switch", () => {
  const fd = new FormData();
  fd.set("patient_id", "p-1");
  fd.set("document_type", "laboratory");
  fd.set("description", ""); // opcional vacío -> omitido
  fd.set("notify", "on"); // switch marcado
  const file = new File([new Uint8Array([1, 2, 3])], "lab.pdf", { type: "application/pdf" });
  fd.set("file", file);

  const body = buildMultipartPayload(
    [
      field("patient_id", "text", { required: true }),
      field("document_type", "select", { required: true }),
      field("description", "textarea"),
      field("notify", "switch"),
    ],
    fd,
    fileField(),
  );

  assert.ok(body instanceof FormData);
  assert.equal(body.get("patient_id"), "p-1");
  assert.equal(body.get("document_type"), "laboratory");
  assert.equal(body.has("description"), false); // opcional vacío omitido
  assert.equal(body.get("notify"), "true"); // switch -> "true"
  const got = body.get("file");
  assert.ok(got instanceof File);
  assert.equal((got as File).name, "lab.pdf");
});

test("buildMultipartPayload no adjunta archivo cuando no se seleccionó (File vacío)", () => {
  const fd = new FormData();
  fd.set("patient_id", "p-1");
  fd.set("file", new File([], "", { type: "application/octet-stream" }));

  const body = buildMultipartPayload(
    [field("patient_id", "text", { required: true })],
    fd,
    fileField(),
  );

  assert.equal(body.get("patient_id"), "p-1");
  assert.equal(body.has("file"), false);
});

test("buildMultipartPayload conserva '' en metadata requerida vacía y omite opcional ausente", () => {
  const fd = new FormData();
  const file = new File([new Uint8Array([9])], "x.pdf", { type: "application/pdf" });
  fd.set("file", file);

  const body = buildMultipartPayload(
    [field("patient_id", "text", { required: true }), field("description", "textarea")],
    fd,
    fileField(),
  );

  assert.equal(body.get("patient_id"), ""); // requerido vacío -> '' (backend lo reporta)
  assert.equal(body.has("description"), false); // opcional ausente -> omitido
  assert.ok(body.get("file") instanceof File);
});
