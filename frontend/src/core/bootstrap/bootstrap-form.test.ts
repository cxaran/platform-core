import test from "node:test";
import assert from "node:assert/strict";

import { ApiRequestError } from "../api/api-error.ts";
import {
  adminStepHasFieldError,
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

test("buildBootstrapPayload includes every required field of the request contract", () => {
  const draft = emptyBootstrapDraft();
  draft.user.name = "Admin";
  draft.user.last_name = "Platform";
  draft.user.email = "admin@example.com";
  draft.user.password = "admin-password-123";
  draft.user.confirm_password = "admin-password-123";

  const payload = buildBootstrapPayload(draft);

  assert.deepEqual(Object.keys(payload.user!).sort(), [
    "confirm_password",
    "email",
    "last_name",
    "name",
    "password",
  ]);
  assert.equal(payload.system_admin_role!.label, "Administrador de plataforma");
  assert.ok(Array.isArray(payload.additional_roles));
  assert.equal("token" in payload, false);
  assert.equal("token" in payload.user!, false);
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

test("adminStepHasFieldError detects step-1 admin field errors", () => {
  assert.equal(adminStepHasFieldError({ "user.name": ["x"] }), true);
  assert.equal(adminStepHasFieldError({ "user.email": ["x"] }), true);
});

test("adminStepHasFieldError ignores step-2 role field errors", () => {
  assert.equal(adminStepHasFieldError({ "system_admin_role.label": ["x"] }), false);
  assert.equal(adminStepHasFieldError({ "additional_roles.name": ["x"] }), false);
  assert.equal(adminStepHasFieldError({}), false);
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

test("parseBootstrapFormError surfaces safe domain message for service errors", () => {
  const parsed = parseBootstrapFormError(
    new ApiRequestError(422, {
      code: "duplicate_role",
      message: "Los roles iniciales deben tener nombres unicos.",
    }),
  );

  assert.equal(parsed.general, "Los roles iniciales deben tener nombres unicos.");
  assert.deepEqual(parsed.fields, {});
});

test("parseBootstrapFormError surfaces invalid_permission message", () => {
  const parsed = parseBootstrapFormError(
    new ApiRequestError(422, {
      code: "invalid_permission",
      message: "El rol contiene permisos no declarados.",
    }),
  );

  assert.equal(parsed.general, "El rol contiene permisos no declarados.");
});

test("parseBootstrapFormError hides unknown 422 messages behind a generic error", () => {
  const parsed = parseBootstrapFormError(
    new ApiRequestError(422, { code: "weird_internal", message: "secret stack trace" }),
  );

  assert.equal(parsed.general?.includes("secret stack trace"), false);
  assert.ok(parsed.general && parsed.general.length > 0);
});

test("parseBootstrapFormError reports additional role field errors as safe general", () => {
  const parsed = parseBootstrapFormError(
    new ApiRequestError(422, {
      code: "validation_error",
      message: "Parámetros inválidos",
      errors: [
        { field: "body.additional_roles.0.name", message: "String should have at least 1 character" },
      ],
    }),
  );

  // No se mapea a un campo (el índice no es fiable); se reporta general seguro.
  assert.deepEqual(parsed.fields, {});
  assert.ok(parsed.general && parsed.general.includes("roles adicionales"));
});
