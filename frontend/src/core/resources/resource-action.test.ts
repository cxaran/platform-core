import test from "node:test";
import assert from "node:assert/strict";

import type {
  ResourceActionCapability,
  ResourceFormFieldCapability,
} from "@/core/api/contracts";

import {
  ActionContractError,
  ADMIN_COVERAGE_MESSAGE,
  actionBody,
  actionErrorMessage,
  actionHasInputSchema,
  actionInputFields,
  actionRequiresConfirmation,
  buildActionPayload,
  evaluateActionCondition,
  isActionEnabled,
  isActionVisible,
  resolveActionUrl,
  shouldOpenDialog,
  visibleActionsForRow,
} from "./resource-action.ts";

type Operator = ResourceActionCapability["visible_when"];

function pred(
  field: string,
  operator: NonNullable<Operator>["all"][number]["operator"],
  value?: unknown,
): NonNullable<Operator>["all"][number] {
  return { field, operator, value };
}

function cond(
  ...predicates: NonNullable<Operator>["all"]
): NonNullable<Operator> {
  return { all: predicates };
}

// Acción mínima con visible_when/enabled_when para los tests del evaluador.
function statefulAction(
  overrides: Partial<ResourceActionCapability> = {},
): ResourceActionCapability {
  return {
    name: "approve",
    label: "Aprobar",
    method: "POST" as const,
    url_template: "/api/v1/prescriptions/{id}/approve",
    scope: "item" as const,
    danger: false,
    success_behavior: "refresh" as const,
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
    label: name,
    type: "string",
    required: false,
    editable: true,
    widget,
    ...overrides,
  };
}

// Acción tipo appointments.reschedule: input_schema sin cuerpo fijo. Sólo confirmación
// no requerida para verificar que igual abre diálogo por tener input_schema.
function rescheduleAction(
  overrides: Partial<ResourceActionCapability> = {},
): ResourceActionCapability {
  return {
    name: "reschedule",
    label: "Reagendar",
    method: "POST" as const,
    url_template: "/api/v1/appointments/{id}/reschedule",
    scope: "item" as const,
    danger: false,
    input_schema: {
      fields: [
        field("doctor_id", "text"),
        field("scheduled_at", "datetime"),
        field("reason", "textarea"),
        field("notify", "switch", { type: "boolean" }),
      ],
    },
    confirmation: {
      required: false,
      title: "Reagendar cita",
      message: "Se creará la cita reprogramada con los datos indicados.",
      confirm_label: "Reagendar",
      destructive: false,
    },
    success_behavior: "refresh" as const,
    ...overrides,
  };
}

function deactivateAction() {
  return {
    name: "deactivate",
    label: "Desactivar",
    method: "PATCH" as const,
    url_template: "/api/v1/users/{id}",
    scope: "item" as const,
    danger: true,
    request: { content_type: "application/json", fixed_body: { is_active: false } },
    confirmation: {
      required: true,
      title: "Desactivar usuario",
      message: "El usuario perderá acceso inmediatamente.",
      confirm_label: "Desactivar",
      destructive: true,
    },
    success_behavior: "refresh" as const,
  };
}

function revokeAction() {
  return {
    name: "revoke_sessions",
    label: "Revocar sesiones",
    method: "POST" as const,
    url_template: "/api/v1/users/{id}/revoke-sessions",
    scope: "item" as const,
    danger: true,
    success_behavior: "refresh" as const,
  };
}

test("resolveActionUrl usa el placeholder declarado, no asume id", () => {
  const url = resolveActionUrl(deactivateAction(), "id", "abc-123");
  assert.equal(url, "/api/v1/users/abc-123");
});

test("actionBody envía exactamente fixed_body", () => {
  assert.deepEqual(actionBody(deactivateAction()), { is_active: false });
});

test("actionBody es una copia: no muta el contrato compartido", () => {
  const action = deactivateAction();
  const body = actionBody(action) as Record<string, unknown>;
  body.injected = true;
  assert.deepEqual(action.request.fixed_body, { is_active: false });
});

test("actionBody es undefined sin request", () => {
  assert.equal(actionBody(revokeAction()), undefined);
});

test("actionRequiresConfirmation refleja el contrato", () => {
  assert.equal(actionRequiresConfirmation(deactivateAction()), true);
  assert.equal(actionRequiresConfirmation(revokeAction()), false);
});

test("actionErrorMessage muestra mensaje seguro para admin_coverage_required", () => {
  assert.equal(actionErrorMessage(409, "admin_coverage_required"), ADMIN_COVERAGE_MESSAGE);
  assert.notEqual(actionErrorMessage(409, "resource_conflict"), ADMIN_COVERAGE_MESSAGE);
  assert.ok(actionErrorMessage(500, undefined).length > 0);
});

test("actionInputFields devuelve los campos declarados o lista vacía", () => {
  assert.equal(actionInputFields(deactivateAction()).length, 0);
  assert.equal(actionInputFields(revokeAction()).length, 0);
  assert.deepEqual(
    actionInputFields(rescheduleAction()).map((f) => f.name),
    ["doctor_id", "scheduled_at", "reason", "notify"],
  );
});

test("actionHasInputSchema distingue acciones con formulario de entrada", () => {
  assert.equal(actionHasInputSchema(rescheduleAction()), true);
  assert.equal(actionHasInputSchema(deactivateAction()), false);
  assert.equal(actionHasInputSchema(revokeAction()), false);
});

test("shouldOpenDialog: confirmación requerida abre diálogo", () => {
  assert.equal(shouldOpenDialog(deactivateAction()), true);
});

test("shouldOpenDialog: input_schema abre diálogo aunque confirmation.required sea false", () => {
  const action = rescheduleAction();
  // confirmation.required es false en esta acción; igual debe abrir por input_schema.
  assert.equal(actionRequiresConfirmation(action), false);
  assert.equal(shouldOpenDialog(action), true);
});

test("shouldOpenDialog: acción sin confirmación ni input_schema no abre diálogo", () => {
  assert.equal(shouldOpenDialog(revokeAction()), false);
});

test("buildActionPayload allowlista los campos declarados (string y switch)", () => {
  const formData = new FormData();
  formData.set("doctor_id", "doc-1");
  formData.set("scheduled_at", "2026-07-01T10:30");
  formData.set("reason", "Cambio de agenda");
  formData.set("notify", "on"); // switch marcado
  // Campo no declarado: debe ignorarse (allowlist).
  formData.set("status", "approved");

  const payload = buildActionPayload(rescheduleAction(), formData);
  assert.deepEqual(payload, {
    doctor_id: "doc-1",
    scheduled_at: "2026-07-01T10:30",
    reason: "Cambio de agenda",
    notify: true,
  });
  assert.equal("status" in payload, false);
});

test("buildActionPayload: switch ausente se envía como false", () => {
  const formData = new FormData();
  formData.set("doctor_id", "doc-1");
  const payload = buildActionPayload(rescheduleAction(), formData);
  assert.equal(payload.notify, false);
  // Campos opcionales ausentes se OMITEN (misma semántica que create): el backend aplica
  // default / no cambia, evitando 422 con cadena vacía o null en campos con default no-nullable.
  assert.equal("reason" in payload, false);
});

test("actionBody con input_schema toma sólo los campos declarados del payload", () => {
  const body = actionBody(rescheduleAction(), {
    doctor_id: "doc-1",
    reason: "x",
    notify: true,
    injected: "no-debe-ir", // clave no declarada
  });
  assert.deepEqual(body, { doctor_id: "doc-1", reason: "x", notify: true });
});

test("actionBody con input_schema sin payload devuelve cuerpo vacío", () => {
  assert.deepEqual(actionBody(rescheduleAction()), {});
});

test("actionBody con fixed_body vacío devuelve {} (no undefined)", () => {
  // Una acción con request.fixed_body = {} debe enviar un cuerpo vacío {}, nunca
  // undefined: el endpoint espera JSON (POST/PATCH) sin campos de usuario.
  const action = statefulAction({
    request: { content_type: "application/json", fixed_body: {} },
  });
  const body = actionBody(action);
  assert.deepEqual(body, {});
  assert.notEqual(body, undefined);
});

test("actionBody rechaza un contrato con request e input_schema simultáneos", () => {
  const corrupt = rescheduleAction({
    request: { content_type: "application/json", fixed_body: { a: 1 } },
  });
  assert.throws(() => actionBody(corrupt), ActionContractError);
});

// --- Evaluador del DSL de estado (visible_when / enabled_when) ---

test("evaluateActionCondition: null/undefined => true (siempre aplica)", () => {
  assert.equal(evaluateActionCondition(null, { status: "approved" }), true);
  assert.equal(evaluateActionCondition(undefined, { status: "approved" }), true);
});

test("evaluateActionCondition: eq cubre y no cubre", () => {
  assert.equal(evaluateActionCondition(cond(pred("status", "eq", "draft")), { status: "draft" }), true);
  assert.equal(evaluateActionCondition(cond(pred("status", "eq", "draft")), { status: "approved" }), false);
});

test("evaluateActionCondition: neq", () => {
  assert.equal(evaluateActionCondition(cond(pred("status", "neq", "draft")), { status: "approved" }), true);
  assert.equal(evaluateActionCondition(cond(pred("status", "neq", "draft")), { status: "draft" }), false);
});

test("evaluateActionCondition: in cubre y no cubre", () => {
  const c = cond(pred("status", "in", ["pending", "confirmed"]));
  assert.equal(evaluateActionCondition(c, { status: "pending" }), true);
  assert.equal(evaluateActionCondition(c, { status: "attended" }), false);
});

test("evaluateActionCondition: not_in", () => {
  const c = cond(pred("status", "not_in", ["cancelled", "attended"]));
  assert.equal(evaluateActionCondition(c, { status: "pending" }), true);
  assert.equal(evaluateActionCondition(c, { status: "cancelled" }), false);
});

test("evaluateActionCondition: is_null cubre y no cubre", () => {
  const c = cond(pred("voided_at", "is_null"));
  assert.equal(evaluateActionCondition(c, { voided_at: null }), true);
  assert.equal(evaluateActionCondition(c, { voided_at: "2026-01-01T00:00:00" }), false);
});

test("evaluateActionCondition: not_null cubre y no cubre", () => {
  const c = cond(pred("approved_at", "not_null"));
  assert.equal(evaluateActionCondition(c, { approved_at: "2026-01-01T00:00:00" }), true);
  assert.equal(evaluateActionCondition(c, { approved_at: null }), false);
});

test("evaluateActionCondition: all es conjunción (todos cumplidos / uno no)", () => {
  const c = cond(pred("status", "eq", "approved"), pred("voided_at", "is_null"));
  assert.equal(evaluateActionCondition(c, { status: "approved", voided_at: null }), true);
  assert.equal(evaluateActionCondition(c, { status: "approved", voided_at: "x" }), false);
  assert.equal(evaluateActionCondition(c, { status: "draft", voided_at: null }), false);
});

test("evaluateActionCondition conservador: campo ausente en row => true (muestra)", () => {
  assert.equal(evaluateActionCondition(cond(pred("status", "eq", "draft")), {}), true);
  // not_null con campo ausente también muestra (no se puede evaluar con certeza).
  assert.equal(evaluateActionCondition(cond(pred("status", "not_null")), {}), true);
});

test("evaluateActionCondition conservador: value null donde no corresponde (eq) => true", () => {
  assert.equal(
    evaluateActionCondition(cond(pred("status", "eq", null)), { status: "draft" }),
    true,
  );
});

test("evaluateActionCondition conservador: tipo inesperado (in sin lista) => true", () => {
  assert.equal(
    evaluateActionCondition(cond(pred("status", "in", "draft")), { status: "approved" }),
    true,
  );
});

test("evaluateActionCondition conservador: all malformado (no array) => true", () => {
  const malformed = { all: "nope" } as unknown as NonNullable<Operator>;
  assert.equal(evaluateActionCondition(malformed, { status: "approved" }), true);
});

test("evaluateActionCondition conservador: operador desconocido => true", () => {
  const corrupt = {
    all: [{ field: "status", operator: "matches", value: "x" }],
  } as unknown as NonNullable<Operator>;
  assert.equal(evaluateActionCondition(corrupt, { status: "approved" }), true);
});

test("evaluateActionCondition: eq con escalar numérico cubre y no cubre", () => {
  // El evaluador soporta cualquier escalar (no sólo string): número con === estricto.
  assert.equal(evaluateActionCondition(cond(pred("count", "eq", 3)), { count: 3 }), true);
  assert.equal(evaluateActionCondition(cond(pred("count", "eq", 3)), { count: 4 }), false);
});

test("evaluateActionCondition conservador: neq con value no escalar => true", () => {
  // neq sólo compara contra escalares; un value con forma inesperada no bloquea.
  const malformed = {
    all: [{ field: "status", operator: "neq", value: ["draft"] }],
  } as unknown as NonNullable<Operator>;
  assert.equal(evaluateActionCondition(malformed, { status: "approved" }), true);
});

test("evaluateActionCondition conservador: not_in con value no array => true", () => {
  assert.equal(
    evaluateActionCondition(cond(pred("status", "not_in", "draft")), { status: "approved" }),
    true,
  );
});

test("evaluateActionCondition conservador: predicado null en all => true", () => {
  const malformed = { all: [null] } as unknown as NonNullable<Operator>;
  assert.equal(evaluateActionCondition(malformed, { status: "approved" }), true);
});

test("evaluateActionCondition conservador: field no string => true", () => {
  const malformed = {
    all: [{ field: 123, operator: "eq", value: "x" }],
  } as unknown as NonNullable<Operator>;
  assert.equal(evaluateActionCondition(malformed, { status: "approved" }), true);
});

test("evaluateActionCondition: is_null/not_null con campo presente y valor undefined", () => {
  // Campo presente (hasOwnProperty true) pero con valor undefined: distinto del campo
  // ausente. is_null lo trata como nulo; not_null como no satisfecho.
  const item = { voided_at: undefined };
  assert.equal(evaluateActionCondition(cond(pred("voided_at", "is_null")), item), true);
  assert.equal(evaluateActionCondition(cond(pred("voided_at", "not_null")), item), false);
});

test("isActionVisible: sin visible_when siempre visible; con condición filtra", () => {
  assert.equal(isActionVisible(statefulAction(), { status: "approved" }), true);
  const gated = statefulAction({ visible_when: cond(pred("status", "eq", "draft")) });
  assert.equal(isActionVisible(gated, { status: "draft" }), true);
  assert.equal(isActionVisible(gated, { status: "approved" }), false);
});

test("isActionEnabled: enabled_when controla habilitación, conservador si falta", () => {
  assert.equal(isActionEnabled(statefulAction(), { status: "x" }), true);
  const gated = statefulAction({ enabled_when: cond(pred("status", "eq", "draft")) });
  assert.equal(isActionEnabled(gated, { status: "draft" }), true);
  assert.equal(isActionEnabled(gated, { status: "approved" }), false);
});

test("visibleActionsForRow filtra acciones por visible_when contra el row", () => {
  const approve = statefulAction({
    name: "approve",
    visible_when: cond(pred("status", "eq", "draft")),
  });
  const voidAction = statefulAction({
    name: "void",
    visible_when: cond(pred("status", "eq", "approved")),
  });
  const remove = statefulAction({ name: "delete" }); // sin condición: siempre visible

  const draftRow = visibleActionsForRow([approve, voidAction, remove], { status: "draft" });
  assert.deepEqual(draftRow.map((a) => a.name), ["approve", "delete"]);

  const approvedRow = visibleActionsForRow([approve, voidAction, remove], { status: "approved" });
  assert.deepEqual(approvedRow.map((a) => a.name), ["void", "delete"]);
});
