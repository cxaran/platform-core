import test from "node:test";
import assert from "node:assert/strict";

import {
  ADMIN_COVERAGE_MESSAGE,
  actionBody,
  actionErrorMessage,
  actionRequiresConfirmation,
  resolveActionUrl,
} from "./resource-action.ts";

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
