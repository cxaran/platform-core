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

from fastapi.testclient import TestClient  # noqa: E402

from backend.app.auth.auth_dependencies import get_current_user  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.app.resources.registry import ROLES, USERS  # noqa: E402
from backend.app.schemas.user import SessionUser  # noqa: E402


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
    def __init__(self, *permissions: str) -> None:
        self.permissions = permissions

    def __enter__(self) -> None:
        app.dependency_overrides[get_current_user] = lambda: session_user(*self.permissions)

    def __exit__(self, *exc: object) -> None:
        app.dependency_overrides.pop(get_current_user, None)


class ResourceFiltersTest(unittest.TestCase):
    def _capability(self, resource: str, *permissions: str) -> dict:
        with _As(*permissions):
            response = client.get(f"/api/v1/resources/{resource}")
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_users_publishes_only_is_active_filter(self) -> None:
        filters = self._capability("users", "users:read")["list"]["filters"]
        self.assertEqual([f["field"] for f in filters], ["is_active"])

    def test_roles_publishes_only_is_active_filter(self) -> None:
        filters = self._capability("roles", "roles:read")["list"]["filters"]
        self.assertEqual([f["field"] for f in filters], ["is_active"])

    def test_filter_shape_is_complete(self) -> None:
        flt = self._capability("users", "users:read")["list"]["filters"][0]
        self.assertEqual(flt["parameter"], "is_active")
        self.assertEqual(flt["operator"], "eq")
        self.assertEqual(flt["label"], "Estado")
        self.assertEqual(flt["type"], "boolean")
        self.assertEqual(flt["widget"], "select")
        self.assertEqual(
            flt["options"],
            [
                {"value": "true", "label": "Activos"},
                {"value": "false", "label": "Inactivos"},
            ],
        )

    def test_options_have_explicit_labels(self) -> None:
        flt = self._capability("roles", "roles:read")["list"]["filters"][0]
        for option in flt["options"]:
            self.assertTrue(option["label"].strip())
            self.assertTrue(option["value"])

    def test_email_is_not_a_filter(self) -> None:
        filters = self._capability("users", "users:read")["list"]["filters"]
        self.assertNotIn("email", [f["field"] for f in filters])

    def test_parameter_exists_in_query_schema(self) -> None:
        users = self._capability("users", "users:read")["list"]
        roles = self._capability("roles", "roles:read")["list"]
        for parameter in (f["parameter"] for f in users["filters"]):
            self.assertIn(parameter, USERS.Query.model_fields)
        for parameter in (f["parameter"] for f in roles["filters"]):
            self.assertIn(parameter, ROLES.Query.model_fields)

    def test_filter_operator_is_within_field_operators(self) -> None:
        cap = self._capability("users", "users:read")["list"]
        field_ops = {field["name"]: field["filter_operators"] for field in cap["fields"]}
        for flt in cap["filters"]:
            self.assertIn(flt["operator"], field_ops[flt["field"]])

    def test_visible_as_filter_absent_from_payload(self) -> None:
        blob = self._capability("users", "users:read")
        self.assertNotIn("visible_as_filter", str(blob))

    def test_permission_filtering_preserved(self) -> None:
        with _As("users:read"):
            names = [r["name"] for r in client.get("/api/v1/resources").json()]
        self.assertEqual(names, ["users"])


class FilterableFieldsTest(unittest.TestCase):
    def _list(self, resource: str, *permissions: str) -> dict:
        with _As(*permissions):
            response = client.get(f"/api/v1/resources/{resource}")
        self.assertEqual(response.status_code, 200)
        return response.json()["list"]

    @staticmethod
    def _by_key(field: dict) -> dict:
        return {operator["key"]: operator for operator in field["operators"]}

    @staticmethod
    def _fields_by_key(list_cap: dict) -> dict:
        return {field["key"]: field for field in list_cap["filterable_fields"]}

    def test_users_publishes_expected_filterable_fields(self) -> None:
        fields = self._fields_by_key(self._list("users", "users:read"))
        # last_name/updated_at no declaran operadores: no aparecen como filtrables.
        self.assertEqual(list(fields.keys()), ["name", "email", "is_active", "created_at"])

    def test_text_field_publishes_text_and_equality_operators(self) -> None:
        fields = self._fields_by_key(self._list("users", "users:read"))
        name = fields["name"]
        self.assertEqual(name["value_type"], "string")
        ops = self._by_key(name)
        self.assertEqual(
            list(ops.keys()), ["contains", "starts_with", "ends_with", "eq", "ne"]
        )
        self.assertEqual(ops["contains"]["parameter_name"], "name_contains")
        self.assertEqual(ops["contains"]["widget"], "text")
        self.assertEqual(ops["contains"]["value_shape"], "single")
        self.assertFalse(ops["contains"]["case_sensitive"])
        self.assertEqual(ops["eq"]["parameter_name"], "name")
        self.assertTrue(ops["eq"]["case_sensitive"])
        self.assertEqual(ops["ne"]["parameter_name"], "name_ne")
        self.assertTrue(ops["ne"]["case_sensitive"])

    def test_is_active_publishes_equals_with_select_options(self) -> None:
        fields = self._fields_by_key(self._list("users", "users:read"))
        ops = self._by_key(fields["is_active"])
        self.assertEqual(list(ops.keys()), ["eq"])
        eq = ops["eq"]
        self.assertEqual(eq["widget"], "select")
        self.assertEqual(eq["parameter_name"], "is_active")
        self.assertEqual(
            eq["options"],
            [
                {"value": "true", "label": "Activos"},
                {"value": "false", "label": "Inactivos"},
            ],
        )

    def test_created_at_publishes_calendar_operators_with_timezone(self) -> None:
        fields = self._fields_by_key(self._list("users", "users:read"))
        created = fields["created_at"]
        self.assertEqual(created["value_type"], "datetime")
        ops = self._by_key(created)
        self.assertEqual(list(ops.keys()), ["on", "before", "after", "between"])
        self.assertEqual(ops["on"]["parameter_name"], "created_at_on")
        self.assertEqual(ops["on"]["widget"], "date")
        # Zona horaria de aplicación publicada explícitamente (default UTC en tests).
        self.assertEqual(ops["on"]["calendar_timezone"], "UTC")

    def test_between_publishes_two_parameters_inclusive(self) -> None:
        fields = self._fields_by_key(self._list("users", "users:read"))
        between = self._by_key(fields["created_at"])["between"]
        self.assertEqual(between["value_shape"], "range")
        self.assertEqual(between["widget"], "daterange")
        self.assertNotIn("parameter_name", between)  # excluido (None) por exclude_none
        self.assertEqual(between["parameters"], {"from": "created_at_from", "to": "created_at_to"})
        self.assertTrue(between["range_end_inclusive"])

    def test_all_published_parameters_exist_in_query_schema(self) -> None:
        for resource, permission, query in (
            ("users", "users:read", USERS.Query),
            ("roles", "roles:read", ROLES.Query),
        ):
            list_cap = self._list(resource, permission)
            for field in list_cap["filterable_fields"]:
                for operator in field["operators"]:
                    if "parameter_name" in operator:
                        self.assertIn(operator["parameter_name"], query.model_fields)
                    if "parameters" in operator:
                        self.assertIn(operator["parameters"]["from"], query.model_fields)
                        self.assertIn(operator["parameters"]["to"], query.model_fields)

    def test_roles_filterable_fields_exclude_internal_and_empty(self) -> None:
        fields = self._fields_by_key(self._list("roles", "roles:read"))
        self.assertEqual(list(fields.keys()), ["name", "is_active", "created_at"])
        self.assertNotIn("id", fields)


class FiltersOpenApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.openapi = client.get("/api/openapi.json").json()

    def test_filter_schemas_present(self) -> None:
        schemas = self.openapi["components"]["schemas"]
        self.assertIn("ResourceFilterCapability", schemas)
        self.assertIn("ResourceFilterOption", schemas)

    def test_filterable_fields_schemas_present(self) -> None:
        schemas = self.openapi["components"]["schemas"]
        self.assertIn("FilterableFieldCapability", schemas)
        self.assertIn("FilterableOperatorCapability", schemas)
        self.assertIn("FilterableRangeParameters", schemas)
        self.assertIn("FilterValueShape", schemas)
        # El alias 'from' (palabra reservada en Python) se publica correctamente.
        self.assertIn("from", schemas["FilterableRangeParameters"]["properties"])

    def test_widget_type_includes_select(self) -> None:
        widget = self.openapi["components"]["schemas"]["WidgetType"]
        self.assertIn("select", widget["enum"])

    def test_widget_type_includes_calendar_widgets(self) -> None:
        widget = self.openapi["components"]["schemas"]["WidgetType"]
        self.assertIn("date", widget["enum"])
        self.assertIn("daterange", widget["enum"])

    def test_visible_as_filter_absent_from_openapi(self) -> None:
        field_schema = self.openapi["components"]["schemas"]["ResourceFieldCapability"]
        self.assertNotIn("visible_as_filter", field_schema["properties"])


if __name__ == "__main__":
    unittest.main()
