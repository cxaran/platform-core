import os
import unittest
from types import SimpleNamespace

from pydantic import SecretStr
from sqlalchemy import create_engine
from sqlmodel import Session, select


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

from backend.app.core import bootstrap  # noqa: E402
from backend.app.models import Base  # noqa: E402
from backend.app.models.user import Role, RoleAccess, User, UserRole  # noqa: E402
from backend.app.security.catalog import declared_permissions  # noqa: E402


class BootstrapInitialDataTest(unittest.TestCase):
    def test_bootstrap_initial_data_is_idempotent(self) -> None:
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        previous_engine = bootstrap.engine
        previous_settings = bootstrap.settings
        bootstrap.engine = engine
        bootstrap.settings = SimpleNamespace(
            bootstrap_admin_email="admin@example.com",
            bootstrap_admin_password=SecretStr("admin-password-123"),
            bootstrap_admin_name="Admin",
            bootstrap_admin_last_name="Platform",
            bootstrap_admin_role_name="Administrador",
            bootstrap_user_role_name="Usuario",
        )

        try:
            bootstrap.bootstrap_initial_data()
            bootstrap.bootstrap_initial_data()
        finally:
            bootstrap.engine = previous_engine
            bootstrap.settings = previous_settings

        permissions = declared_permissions()

        with Session(engine) as session:
            users = session.exec(select(User)).all()
            roles = session.exec(select(Role)).all()
            user_roles = session.exec(select(UserRole)).all()
            accesses = session.exec(select(RoleAccess)).all()

        self.assertEqual(len(users), 1)
        self.assertEqual(users[0].email, "admin@example.com")
        self.assertTrue(users[0].is_active)

        self.assertEqual({role.name for role in roles}, {"Administrador", "Usuario"})
        self.assertEqual(len(user_roles), 1)
        self.assertEqual(len(accesses), len(permissions))
        self.assertEqual({access.access for access in accesses}, permissions)
        self.assertTrue(all(access.is_active for access in accesses))


if __name__ == "__main__":
    unittest.main()
