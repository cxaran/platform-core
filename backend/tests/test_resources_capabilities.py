import os
import unittest
import uuid


DEV_ENV = {
    "ENVIRONMENT": "local",
    "SECRET_KEY": "test-secret-key",
    "ACCESS_TOKEN_EXPIRE_MINUTES": "30",
    "EMAIL_TOKEN_EXPIRE_MINUTES": "30",
    "TRYS_BEFORE_LOCK": "5",
    "REDIS_HOST": "redis",
    "REDIS_PORT": "6379",
    "REDIS_DB": "0",
    "SMTP_HOST": "mailpit",
    "SMTP_PORT": "1025",
    "SMTP_USER": "test@example.com",
    "SMTP_PASSWORD": "test-password",
    "SMTP_FROM_EMAIL": "test@example.com",
    "SMTP_FROM_NAME": "Platform Core Test",
    "SMTP_TLS": "false",
    "SMTP_SSL": "false",
    "SMTP_USE_CREDENTIALS": "false",
    "POSTGRES_USER": "platform",
    "POSTGRES_PASSWORD": "platform",
    "POSTGRES_SERVER": "postgres",
    "POSTGRES_PORT": "5432",
    "POSTGRES_DB": "platform_core",
}

os.environ.update(DEV_ENV)

import json  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from backend.app.auth.auth_dependencies import get_current_user  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.app.resources.projection import (  # noqa: E402
    CapabilityConfigError,
    _require_label,
)
from backend.app.resources.registry import USERS  # noqa: E402
from backend.app.schemas.user import SessionUser  # noqa: E402
from backend.app.security.catalog import declared_permissions  # noqa: E402


client = TestClient(app)


def session_user(*permissions: str) -> SessionUser:
    return SessionUser(
        id=uuid.uuid4(),
        name="Tester",
        last_name="Apellido",
        email="tester@example.com",
        permissions=set(permissions),
    )


class _As:
    """Context manager que sobreescribe ``get_current_user`` con permisos dados."""

    def __init__(self, *permissions: str) -> None:
        self.permissions = permissions

    def __enter__(self) -> None:
        app.dependency_overrides[get_current_user] = lambda: session_user(*self.permissions)

    def __exit__(self, *exc: object) -> None:
        app.dependency_overrides.pop(get_current_user, None)


class ResourcesAuthTest(unittest.TestCase):
    def test_anonymous_gets_401(self) -> None:
        self.assertEqual(client.get("/api/v1/resources").status_code, 401)

    def test_partial_permissions_only_returns_allowed_resources(self) -> None:
        with _As("users:read"):
            body = client.get("/api/v1/resources").json()
        names = [resource["name"] for resource in body]
        self.assertEqual(names, ["users"])

    def test_revoke_visible_resource_requires_read_not_revoke(self) -> None:
        # Tiene revoke pero no read: no debe ver el recurso users en el catálogo.
        with _As("users:revoke_sessions"):
            body = client.get("/api/v1/resources").json()
        self.assertEqual([r["name"] for r in body], [])

    def test_hidden_and_missing_return_same_404(self) -> None:
        with _As("users:read"):
            hidden = client.get("/api/v1/resources/roles")
            missing = client.get("/api/v1/resources/does-not-exist")
        self.assertEqual(hidden.status_code, 404)
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(hidden.json(), missing.json())
        self.assertEqual(hidden.json()["code"], "resource_not_found")


class ResourcesActionTest(unittest.TestCase):
    def test_revoke_action_absent_without_permission(self) -> None:
        with _As("users:read"):
            users = client.get("/api/v1/resources/users").json()
        action_names = [action["name"] for action in users["actions"]]
        self.assertNotIn("revoke_sessions", action_names)

    def test_revoke_action_present_with_permission(self) -> None:
        with _As("users:read", "users:revoke_sessions"):
            users = client.get("/api/v1/resources/users").json()
        action = next(a for a in users["actions"] if a["name"] == "revoke_sessions")
        self.assertEqual(action["method"], "POST")
        self.assertEqual(action["url_template"], "/api/v1/users/{id}/revoke-sessions")
        self.assertEqual(action["scope"], "item")
        self.assertTrue(action["danger"])

    def test_delete_action_only_with_delete_permission(self) -> None:
        with _As("users:read"):
            without = client.get("/api/v1/resources/users").json()
        with _As("users:read", "users:delete"):
            withp = client.get("/api/v1/resources/users").json()
        self.assertNotIn("delete", [a["name"] for a in without["actions"]])
        self.assertIn("delete", [a["name"] for a in withp["actions"]])

    def test_forms_omitted_without_permission(self) -> None:
        with _As("users:read"):
            users = client.get("/api/v1/resources/users").json()
        self.assertNotIn("forms", users)

    def test_create_form_present_only_with_create_permission(self) -> None:
        with _As("users:read", "users:create"):
            users = client.get("/api/v1/resources/users").json()
        self.assertIn("create", users["forms"])
        self.assertNotIn("update", users["forms"])
        create = users["forms"]["create"]
        self.assertEqual(create["method"], "POST")
        self.assertEqual(create["url_template"], "/api/v1/users")
        names = [f["name"] for f in create["fields"]]
        self.assertIn("password", names)
        password = next(f for f in create["fields"] if f["name"] == "password")
        self.assertEqual(password["widget"], "password")


class RevokeEndpointPermissionTest(unittest.TestCase):
    def test_revoke_with_update_but_not_revoke_is_403(self) -> None:
        with _As("users:update"):
            response = client.post(f"/api/v1/users/{uuid.uuid4()}/revoke-sessions")
        self.assertEqual(response.status_code, 403)


class PermissionsResourceTest(unittest.TestCase):
    def test_permissions_requires_its_read_permission(self) -> None:
        with _As("users:read"):
            names = [r["name"] for r in client.get("/api/v1/resources").json()]
        self.assertNotIn("permissions", names)

    def test_permissions_is_grouped_catalog_without_table_shape(self) -> None:
        with _As("permissions:read"):
            body = client.get("/api/v1/resources/permissions").json()
        self.assertEqual(body["view"], "grouped_catalog")
        self.assertNotIn("list", body)
        self.assertNotIn("forms", body)
        self.assertEqual(body["actions"], [])


class CapabilityContentTest(unittest.TestCase):
    def test_no_permission_strings_leak_in_payload(self) -> None:
        with _As(*declared_permissions()):
            blob = json.dumps(client.get("/api/v1/resources").json())
        leaks = [permission for permission in declared_permissions() if permission in blob]
        self.assertEqual(leaks, [])

    def test_id_not_a_default_list_column(self) -> None:
        with _As("users:read"):
            users = client.get("/api/v1/resources/users").json()
        self.assertNotIn("id", [field["name"] for field in users["list"]["fields"]])

    def test_all_projected_fields_have_labels(self) -> None:
        with _As(*declared_permissions()):
            resources = client.get("/api/v1/resources").json()
        for resource in resources:
            for field in resource.get("list", {}).get("fields", []):
                self.assertTrue(field["label"], resource["name"])
            forms = resource.get("forms", {})
            for form in (forms.get("create"), forms.get("update")):
                for field in (form or {}).get("fields", []):
                    self.assertTrue(field["label"], resource["name"])

    def test_list_capabilities_reflect_query_plan(self) -> None:
        plan = USERS.plan
        with _As("users:read"):
            users = client.get("/api/v1/resources/users").json()
        list_cap = users["list"]
        self.assertEqual(list_cap["sort"]["default_sort"], plan.default_order)
        self.assertFalse(list_cap["sort"]["fixed_server_order"])
        for field in list_cap["fields"]:
            self.assertEqual(field["sortable"], field["name"] in plan.public_sort_columns)

    def test_missing_label_raises(self) -> None:
        class NoLabel(BaseModel):
            value: str = Field(json_schema_extra={"ui": {"list": True}})

        with self.assertRaises(CapabilityConfigError):
            _require_label(NoLabel.model_fields["value"], "value")


class ResourceRelationsTest(unittest.TestCase):
    def test_roles_relation_absent_without_manage_roles(self) -> None:
        with _As("users:read"):
            users = client.get("/api/v1/resources/users").json()
        self.assertEqual(users.get("relations", []), [])

    def test_roles_relation_present_with_manage_roles(self) -> None:
        with _As("users:read", "users:manage_roles"):
            users = client.get("/api/v1/resources/users").json()
        relation = next(r for r in users["relations"] if r["name"] == "roles")
        self.assertEqual(relation["cardinality"], "multiple")
        self.assertTrue(relation["editable"])
        self.assertEqual(relation["selection_url"], "/api/v1/users/{id}/roles")
        self.assertEqual(relation["mutation_method"], "PUT")
        self.assertEqual(relation["mutation_url"], "/api/v1/users/{id}/roles")
        self.assertEqual(relation["request_field"], "role_ids")
        # Selección paginada: sin selection_field (se lee items[].id).
        self.assertNotIn("selection_field", relation)
        self.assertEqual(relation["options"]["type"], "list")
        self.assertEqual(relation["options"]["url"], "/api/v1/roles")
        self.assertEqual(relation["options"]["value_field"], "id")
        self.assertEqual(relation["options"]["label_field"], "name")

    def test_permissions_relation_present_with_manage_permissions(self) -> None:
        with _As("roles:read", "roles:manage_permissions"):
            roles = client.get("/api/v1/resources/roles").json()
        relation = next(r for r in roles["relations"] if r["name"] == "permissions")
        self.assertEqual(relation["selection_url"], "/api/v1/roles/{id}/permissions")
        self.assertEqual(relation["selection_field"], "permissions")
        self.assertEqual(relation["mutation_url"], "/api/v1/roles/{id}/permissions")
        self.assertEqual(relation["request_field"], "permissions")
        self.assertEqual(relation["options"]["type"], "grouped_catalog")
        self.assertEqual(relation["options"]["url"], "/api/v1/permissions")
        self.assertEqual(relation["options"]["value_field"], "access")

    def test_permissions_relation_absent_without_manage_permissions(self) -> None:
        with _As("roles:read"):
            roles = client.get("/api/v1/resources/roles").json()
        self.assertEqual(roles.get("relations", []), [])


class PermissionsCatalogTest(unittest.TestCase):
    def test_requires_permissions_read(self) -> None:
        with _As("users:read"):
            self.assertEqual(client.get("/api/v1/permissions").status_code, 403)

    def test_grouped_catalog_exposes_labels(self) -> None:
        with _As("permissions:read"):
            groups = client.get("/api/v1/permissions").json()
        names = [group["name"] for group in groups]
        self.assertEqual(names, ["users", "roles", "permissions"])
        for group in groups:
            self.assertTrue(group["label"])
            for permission in group["permissions"]:
                self.assertTrue(permission["access"])
                self.assertTrue(permission["label"])


class ResourcesOpenApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.openapi = client.get("/api/openapi.json").json()

    def test_endpoints_present(self) -> None:
        paths = self.openapi["paths"]
        self.assertIn("/api/v1/resources", paths)
        self.assertIn("/api/v1/resources/{resource_name}", paths)

    def test_capability_schemas_and_enums_present(self) -> None:
        schemas = self.openapi["components"]["schemas"]
        for name in (
            "ResourceCapability",
            "ResourceListCapability",
            "ResourceFieldCapability",
            "ResourceActionCapability",
            "ResourceFormCapability",
            "ResourceFormFieldCapability",
            "ResourceRelationCapability",
            "RelationOptionsSource",
            "RelationCardinality",
            "OptionsSourceType",
            "FieldValueType",
            "WidgetType",
            "FilterOperator",
            "HttpMethod",
            "ActionScope",
            "ResourceView",
        ):
            self.assertIn(name, schemas)


if __name__ == "__main__":
    unittest.main()
