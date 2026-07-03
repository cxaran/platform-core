import test from "node:test";
import assert from "node:assert/strict";

import {
  relationItemId,
  relationItemLabel,
  relationItemSecondary,
  resolveRelationTarget,
} from "./relation-picker.ts";

// --- resolveRelationTarget (resolución campo FK -> recurso destino) ---

test("resolveRelationTarget: patient_id -> patients (etiqueta full_name)", () => {
  const target = resolveRelationTarget("patient_id");
  assert.ok(target);
  assert.equal(target.resource, "patients");
  assert.equal(target.field, "patient_id");
  assert.deepEqual(target.labelFields, ["full_name"]);
});

test("resolveRelationTarget: doctor_id y attending_doctor_id -> doctors", () => {
  assert.equal(resolveRelationTarget("doctor_id")?.resource, "doctors");
  const attending = resolveRelationTarget("attending_doctor_id");
  assert.equal(attending?.resource, "doctors");
  assert.deepEqual(attending?.labelFields, ["professional_name"]);
});

test("resolveRelationTarget: consultation_id -> consultations", () => {
  const target = resolveRelationTarget("consultation_id");
  assert.equal(target?.resource, "consultations");
  assert.deepEqual(target?.labelFields, ["reason_for_visit"]);
});

test("resolveRelationTarget: FK clínicas ampliadas resuelven su recurso destino", () => {
  assert.equal(resolveRelationTarget("appointment_id")?.resource, "appointments");
  assert.deepEqual(resolveRelationTarget("appointment_id")?.labelFields, ["reason"]);
  assert.equal(resolveRelationTarget("prescription_id")?.resource, "prescriptions");
  assert.deepEqual(resolveRelationTarget("prescription_id")?.labelFields, ["internal_folio"]);
  assert.equal(resolveRelationTarget("related_diagnosis_id")?.resource, "consultation_diagnoses");
  assert.deepEqual(resolveRelationTarget("related_diagnosis_id")?.labelFields, ["diagnosis_text"]);
  assert.equal(resolveRelationTarget("user_id")?.resource, "users");
  assert.deepEqual(resolveRelationTarget("user_id")?.labelFields, ["full_name", "name", "email"]);
  // El campo se conserva en el target resuelto.
  assert.equal(resolveRelationTarget("user_id")?.field, "user_id");
});

test("resolveRelationTarget: campos de AUDITORÍA y no-FK devuelven null (texto manual)", () => {
  // Auditoría: apuntan a usuarios pero NO son relaciones elegibles (las fija el backend).
  assert.equal(resolveRelationTarget("created_by"), null);
  assert.equal(resolveRelationTarget("updated_by"), null);
  assert.equal(resolveRelationTarget("deleted_by"), null);
  // No-FK / vacío.
  assert.equal(resolveRelationTarget("full_name"), null);
  assert.equal(resolveRelationTarget(""), null);
});

test("resolveRelationTarget: sin regresión en los mapeos previos", () => {
  assert.equal(resolveRelationTarget("patient_id")?.resource, "patients");
  assert.equal(resolveRelationTarget("doctor_id")?.resource, "doctors");
  assert.equal(resolveRelationTarget("attending_doctor_id")?.resource, "doctors");
  assert.equal(resolveRelationTarget("consultation_id")?.resource, "consultations");
});

// --- relationItemId / label / secondary ---

test("relationItemId: lee id string y coacciona no-string; null si falta", () => {
  assert.equal(relationItemId({ id: "p-1" }), "p-1");
  assert.equal(relationItemId({ id: 42 }), "42");
  assert.equal(relationItemId({}), null);
  assert.equal(relationItemId({ id: null }), null);
});

test("relationItemLabel: usa el primer labelField con valor; cae al id", () => {
  const target = resolveRelationTarget("patient_id")!;
  assert.equal(relationItemLabel({ id: "p-1", full_name: "Ana López" }, target), "Ana López");
  // Sin full_name -> cae al id.
  assert.equal(relationItemLabel({ id: "p-1", full_name: "" }, target), "p-1");
  assert.equal(relationItemLabel({ id: "p-1" }, target), "p-1");
});

test("relationItemSecondary: primer secondaryField con valor (incluye numéricos)", () => {
  const target = resolveRelationTarget("patient_id")!;
  assert.equal(
    relationItemSecondary({ id: "p-1", record_number: 1024 }, target),
    "1024",
  );
  // Sin record_number ni curp -> null.
  assert.equal(relationItemSecondary({ id: "p-1" }, target), null);
});
