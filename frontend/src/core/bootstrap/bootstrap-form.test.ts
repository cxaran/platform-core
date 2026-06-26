import test from "node:test";
import assert from "node:assert/strict";

import { ApiRequestError } from "../api/api-error.ts";
import {
  buildBootstrapPayload,
  canAddAdditionalRole,
  canRequestBootstrapCatalog,
  checkedPermissions,
  emptyBootstrapDraft,
  parseBootstrapFormError,
  shouldShowBootstrapTokenField,
} from "./bootstrap-form.ts";

const catalog = {
  limits: { max_additional_roles: 1 },
  permission_groups: [
    {
      name: "users",
      label: "Usuarios",
      permissions: [
        { access: "users:read", label: "Consultar usuarios", description: "" },
      ],
    },
  ],
};

test("token field follows status", () => {
  assert.equal(shouldShowBootstrapTokenField({ setup_required: true, token_required: true }), true);
  assert.equal(shouldShowBootstrapTokenField({ setup_required: true, token_required: false }), false);
});

test("catalog is blocked until token is captured when required", () => {
  assert.equal(canRequestBootstrapCatalog({ setup_required: true, token_required: true }, ""), false);
  assert.equal(canRequestBootstrapCatalog({ setup_required: true, token_required: true }, " token "), true);
  assert.equal(canRequestBootstrapCatalog({ setup_required: true, token_required: false }, ""), true);
});

test("buildBootstrapPayload excludes token and system admin permissions", () => {
  const draft = emptyBootstrapDraft();
  draft.user.name = "Admin";
  draft.user.last_name = "Platform";
  draft.user.email = "admin@example.com";
  draft.user.password = "admin-password-123";
  draft.user.confirm_password = "admin-password-123";
  draft.additional_roles = [
    {
      key: "role-1",
      name: "Operación",
      description: "Rol inicial",
      permissions: ["users:read", "users:read"],
      assign_to_initial_user: true,
    },
  ];

  const payload = buildBootstrapPayload({ ...draft, token: "secret" } as never);

  assert.equal("token" in payload, false);
  assert.equal("permissions" in payload.system_admin_role!, false);
  assert.deepEqual(payload.additional_roles![0]?.permissions, ["users:read"]);
});

test("buildBootstrapPayload ignores injected DOM-like fields", () => {
  const draft = emptyBootstrapDraft() as never as ReturnType<typeof emptyBootstrapDraft> & {
    is_admin: boolean;
    user: ReturnType<typeof emptyBootstrapDraft>["user"] & { injected: string };
  };
  draft.is_admin = true;
  draft.user.injected = "bad";

  const payload = buildBootstrapPayload(draft);

  assert.equal("is_admin" in payload, false);
  assert.equal("injected" in payload.user, false);
});

test("checkedPermissions serializes only permissions from catalog", () => {
  const selected = checkedPermissions(
    catalog.permission_groups,
    ["users:read", "roles:delete"],
  );

  assert.deepEqual(selected, ["users:read"]);
});

test("additional roles respect backend limit", () => {
  const draft = emptyBootstrapDraft();
  assert.equal(canAddAdditionalRole(draft, catalog), true);
  draft.additional_roles.push({
    key: "role-1",
    name: "Operación",
    description: "",
    permissions: [],
    assign_to_initial_user: false,
  });
  assert.equal(canAddAdditionalRole(draft, catalog), false);
});

test("parseBootstrapFormError redirects completed bootstrap to login", () => {
  const parsed = parseBootstrapFormError(
    new ApiRequestError(409, { code: "bootstrap_completed", message: "cerrado" }),
  );

  assert.equal(parsed.redirectToLogin, true);
});

test("parseBootstrapFormError only exposes declared field errors", () => {
  const parsed = parseBootstrapFormError(
    new ApiRequestError(422, {
      code: "validation_error",
      message: "invalid",
      errors: [
        { field: "body.user.email", message: "Email inválido" },
        { field: "body.token", message: "token leaked" },
      ],
    }),
  );

  assert.deepEqual(parsed.fields["user.email"], ["Email inválido"]);
  assert.equal(parsed.general?.includes("token leaked"), false);
});
