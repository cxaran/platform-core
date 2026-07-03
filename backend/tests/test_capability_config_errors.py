import os
import unittest


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

from typing import Any  # noqa: E402

from pydantic import Field  # noqa: E402
from sqlalchemy import Boolean, Integer, String  # noqa: E402
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column  # noqa: E402

from backend.app.query import QueryOptions, ResourceQuery  # noqa: E402
from backend.app.resources import projection  # noqa: E402
from backend.app.resources.projection import CapabilityConfigError  # noqa: E402
from backend.app.resources.registry import ResourceDefinition  # noqa: E402
from backend.app.schemas.base import ApiReadSchema  # noqa: E402
from backend.app.schemas.capabilities import ResourceView  # noqa: E402
from backend.app.security.groups.users import UserPermissions  # noqa: E402


class Base(DeclarativeBase):
    pass


class Thing(Base):
    __tablename__ = "config_error_thing"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False)


def make_list_schema(filter_decl: Any) -> type[ApiReadSchema]:
    from pydantic import create_model

    return create_model(
        "SynthList",
        __base__=ApiReadSchema,
        id=(int, Field(title="ID")),
        is_active=(
            bool,
            Field(title="Activo", json_schema_extra={"ui": {"list": True, "filter": filter_decl}}),
        ),
    )


def make_definition(filter_decl: Any) -> ResourceDefinition:
    list_schema = make_list_schema(filter_decl)
    resource_query = ResourceQuery(
        name="SynthQuery",
        model=Thing,
        schema=list_schema,
        options=QueryOptions(filter_fields=("is_active",)),
    )
    return ResourceDefinition(
        name="synth",
        label="Synth",
        api_path="/api/v1/synth",
        view=ResourceView.TABLE,
        read_permission=UserPermissions.READ,
        list_query=resource_query,
        list_schema=list_schema,
    )


def select(options: Any, *, label: str = "Estado", operator: str = "eq") -> dict[str, Any]:
    return {"operator": operator, "label": label, "widget": "select", "options": options}


class CapabilityConfigErrorTest(unittest.TestCase):
    def _assert_raises(self, filter_decl: Any) -> None:
        with self.assertRaises(CapabilityConfigError):
            projection._list_capability(make_definition(filter_decl))

    def test_select_without_options_fails(self) -> None:
        self._assert_raises({"operator": "eq", "label": "Estado", "widget": "select"})

    def test_select_empty_options_fails(self) -> None:
        self._assert_raises(select([]))

    def test_duplicate_option_value_fails(self) -> None:
        self._assert_raises(
            select([{"value": "true", "label": "A"}, {"value": "true", "label": "B"}])
        )

    def test_empty_option_value_fails(self) -> None:
        self._assert_raises(select([{"value": "", "label": "A"}]))

    def test_empty_option_label_fails(self) -> None:
        self._assert_raises(select([{"value": "true", "label": "   "}]))

    def test_empty_filter_label_fails(self) -> None:
        self._assert_raises(select([{"value": "true", "label": "A"}], label="   "))

    def test_operator_outside_plan_fails(self) -> None:
        # is_active solo declara eq en el plan; "in" no existe para el campo.
        self._assert_raises(select([{"value": "true", "label": "A"}], operator="in"))

    def test_invalid_operator_fails(self) -> None:
        self._assert_raises(select([{"value": "true", "label": "A"}], operator="bogus"))

    def test_invalid_widget_fails(self) -> None:
        self._assert_raises(
            {
                "operator": "eq",
                "label": "Estado",
                "widget": "bogus",
                "options": [{"value": "true", "label": "A"}],
            }
        )

    def test_valid_declaration_does_not_raise(self) -> None:
        capability = projection._list_capability(
            make_definition(select([{"value": "true", "label": "Activos"}]))
        )
        field = next(f for f in capability.filterable_fields if f.key == "is_active")
        eq = next(o for o in field.operators if o.key == "eq")
        self.assertEqual([o.value for o in (eq.options or [])], ["true"])


if __name__ == "__main__":
    unittest.main()
