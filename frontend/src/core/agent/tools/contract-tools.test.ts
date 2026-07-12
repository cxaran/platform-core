import test from "node:test";
import assert from "node:assert/strict";

import { deriveResourceTools } from "./contract-tools.ts";
import type { ToolExecutionContext } from "./registry.ts";
import type { ResourceCatalog } from "@/core/api/contracts";

// Catálogo con la FORMA que devuelve /api/v1/resources para el recurso `users` de platform-core
// (ya proyectado por RBAC). Se castea a ResourceCatalog: el test verifica el COMPORTAMIENTO de
// derivación (nombres, kind, URLs, parámetros), no la exhaustividad de los campos opcionales.
const usersCatalog = [
  {
    name: "users",
    label: "Usuario",
    api_path: "/api/v1/users",
    view: "table",
    item_reference: { placeholder: "id", field: "id" },
    detail: { url_template: "/api/v1/users/{id}" },
    list: {
      fields: [],
      filterable_fields: [
        {
          name: "is_active",
          label: "Activo",
          value_type: "boolean",
          operators: [{ key: "eq", label: "Igual", parameter_name: "is_active" }],
        },
        {
          name: "email",
          label: "Correo",
          value_type: "string",
          operators: [
            { key: "eq", label: "Igual", parameter_name: "email" },
            { key: "contains", label: "Contiene", parameter_name: "email_contains" },
          ],
        },
      ],
    },
    forms: {
      create: {
        method: "POST",
        url_template: "/api/v1/users",
        fields: [
          { name: "name", label: "Nombre", type: "string", required: true, editable: true },
          { name: "email", label: "Correo", type: "email", required: true, editable: true },
          { name: "is_active", label: "Activo", type: "boolean", required: false, editable: true },
        ],
      },
      update: {
        method: "PATCH",
        url_template: "/api/v1/users/{id}",
        fields: [
          { name: "name", label: "Nombre", type: "string", required: false, editable: true },
        ],
      },
    },
    actions: [
      {
        name: "deactivate",
        label: "Desactivar",
        method: "PATCH",
        url_template: "/api/v1/users/{id}",
        scope: "item",
        danger: false,
        request: { fixed_body: { is_active: false } },
      },
    ],
  },
] as unknown as ResourceCatalog;

test("deriveResourceTools genera las tools esperadas para un recurso", () => {
  const tools = deriveResourceTools(usersCatalog);
  const names = new Set(tools.map((tool) => tool.name));

  assert.ok(names.has("resource.list_users"), "debe derivar list");
  assert.ok(names.has("resource.get_users"), "debe derivar get");
  assert.ok(names.has("resource.create_users"), "debe derivar create");
  assert.ok(names.has("resource.update_users"), "debe derivar update");
  assert.ok(names.has("resource.action_users_deactivate"), "debe derivar la acción");
});

test("las lecturas son kind:read y las escrituras kind:write con aprobación", () => {
  const tools = deriveResourceTools(usersCatalog);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  assert.equal(byName.get("resource.list_users")?.kind, "read");
  assert.equal(byName.get("resource.get_users")?.kind, "read");

  const create = byName.get("resource.create_users");
  assert.equal(create?.kind, "write");
  assert.equal(create?.approval?.targetResource, "users");
  assert.equal(create?.approval?.actionType, "create_users");
  assert.equal(create?.approval?.preauthorized, true);

  const action = byName.get("resource.action_users_deactivate");
  assert.equal(action?.kind, "write");
});

test("list expone los parámetros de filtro del contrato y arma la query", async () => {
  const tools = deriveResourceTools(usersCatalog);
  const list = tools.find((tool) => tool.name === "resource.list_users");
  assert.ok(list);

  // El wireSchema (lo que ve el modelo) declara los parameter_name exactos del contrato.
  const props = (list!.wireSchema as { properties: Record<string, unknown> }).properties;
  assert.ok("is_active" in props);
  assert.ok("email" in props);
  assert.ok("email_contains" in props);

  // La ejecución construye la URL con los parámetros del contrato, no inventa sufijos.
  let calledUrl = "";
  const ctx = {
    api: async (path: string) => {
      calledUrl = path;
      return { items: [] };
    },
    sandbox: async () => ({ ok: true, logs: [] }),
  } as unknown as ToolExecutionContext;

  await list!.execute({ limit: 5, email_contains: "acme" }, ctx);
  assert.match(calledUrl, /^\/api\/v1\/users\?/);
  assert.match(calledUrl, /limit=5/);
  assert.match(calledUrl, /email_contains=acme/);
});

test("create ejecuta un POST con solo los campos declarados (allowlist)", async () => {
  const tools = deriveResourceTools(usersCatalog);
  const create = tools.find((tool) => tool.name === "resource.create_users");
  assert.ok(create);

  let method = "";
  let body: unknown = null;
  const ctx = {
    api: async (_path: string, init?: { method?: string; body?: unknown }) => {
      method = init?.method ?? "";
      body = init?.body ?? null;
      return { id: "new" };
    },
    sandbox: async () => ({ ok: true, logs: [] }),
  } as unknown as ToolExecutionContext;

  // 'rol' no está en el contrato: se descarta (allowlist).
  await create!.execute({ name: "Ana", email: "ana@acme.com", rol: "hacker" }, ctx);
  assert.equal(method, "POST");
  assert.deepEqual(body, { name: "Ana", email: "ana@acme.com" });
});
