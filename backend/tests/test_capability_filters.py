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


class LegacyFiltersRemovedTest(unittest.TestCase):
    """El contrato legacy ``filters`` se RETIRÓ: filterable_fields es la fuente única
    (el legacy derivaba solo de ui.filter manual y dejaba al copiloto sin los
    operadores automáticos del plan)."""

    def _capability(self, resource: str, *permissions: str) -> dict:
        with _As(*permissions):
            response = client.get(f"/api/v1/resources/{resource}")
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_legacy_filters_absent_from_payload(self) -> None:
        cap = self._capability("users", "users:read")
        self.assertNotIn("filters", cap["list"])

    def test_plan_fields_are_filterable_including_email(self) -> None:
        # Cambio de semántica vs el legacy: el contrato único publica TODO campo del
        # plan compilado (email incluido); el legacy solo mostraba ui.filter manual.
        cap = self._capability("users", "users:read")["list"]
        self.assertIn("email", {f["key"] for f in cap["filterable_fields"]})

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

    def test_date_field_publishes_equality_and_range_bounds(self) -> None:
        # Un campo ``date`` en ``filter_fields`` publica AUTOMÁTICAMENTE igualdad por
        # día (``eq``) + extremos de rango ``gte``/``lte`` (un solo valor cada uno,
        # widget de fecha). En fechas, los extremos llevan la zona en que el cliente
        # interpreta las fechas civiles (default UTC en tests). Ningún recurso del
        # core tiene columna ``date``, así que se verifica con un recurso sintético.
        from datetime import date

        from pydantic import Field
        from sqlalchemy import Date, Integer
        from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

        from backend.app.query import QueryOptions, ResourceQuery
        from backend.app.resources import projection
        from backend.app.resources.registry import ResourceDefinition
        from backend.app.schemas.base import ApiReadSchema
        from backend.app.schemas.capabilities import ResourceView
        from backend.app.security.groups.users import UserPermissions

        class Base(DeclarativeBase):
            pass

        class Booking(Base):
            __tablename__ = "filterable_date_booking"

            id: Mapped[int] = mapped_column(Integer, primary_key=True)
            scheduled_date: Mapped[date] = mapped_column(Date, nullable=False)

        class BookingListItem(ApiReadSchema):
            id: int = Field(title="ID")
            scheduled_date: date = Field(
                title="Fecha", json_schema_extra={"ui": {"list": True}}
            )

        definition = ResourceDefinition(
            name="synth_bookings",
            label="Reservas",
            api_path="/api/v1/synth-bookings",
            view=ResourceView.TABLE,
            read_permission=UserPermissions.READ,
            list_query=ResourceQuery(
                name="SynthBookingQuery",
                model=Booking,
                schema=BookingListItem,
                options=QueryOptions(
                    filter_fields=("scheduled_date",),
                    sort_fields=("scheduled_date",),
                    default_sort="scheduled_date",
                ),
            ),
            list_schema=BookingListItem,
        )
        list_cap = projection._list_capability(definition).model_dump(
            exclude_none=True, by_alias=True
        )
        fields = self._fields_by_key(list_cap)
        scheduled = fields["scheduled_date"]
        self.assertEqual(scheduled["value_type"], "date")
        ops = self._by_key(scheduled)
        self.assertEqual(list(ops.keys()), ["eq", "gte", "lte"])
        self.assertEqual(ops["eq"]["parameter_name"], "scheduled_date")
        self.assertEqual(ops["eq"]["widget"], "date")
        self.assertEqual(ops["gte"]["parameter_name"], "scheduled_date_gte")
        self.assertEqual(ops["gte"]["widget"], "date")
        self.assertEqual(ops["gte"]["value_shape"], "single")
        self.assertEqual(ops["gte"]["calendar_timezone"], "UTC")
        self.assertEqual(ops["lte"]["parameter_name"], "scheduled_date_lte")
        self.assertEqual(ops["lte"]["calendar_timezone"], "UTC")


class FiltersOpenApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.openapi = client.get("/api/openapi.json").json()

    def test_filter_schemas_present(self) -> None:
        schemas = self.openapi["components"]["schemas"]
        # El schema legacy se retiró del contrato; las opciones se conservan
        # (las usan filterable_fields y los formularios).
        self.assertNotIn("ResourceFilterCapability", schemas)
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
