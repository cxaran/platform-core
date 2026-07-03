import os
import unittest
from types import SimpleNamespace

from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
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

from backend.app.api.v1 import bootstrap as bootstrap_router  # noqa: E402
from backend.app.core.database import get_db  # noqa: E402
from backend.app.core.settings import Settings, settings  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.app.models import Base  # noqa: E402
from backend.app.models.setup import PlatformSetup  # noqa: E402
from backend.app.models.user import Role, RoleAccess, User, UserRole  # noqa: E402
from backend.app.security.catalog import declared_permissions  # noqa: E402


BASE_SETTINGS = {
    "secret_key": "k",
    "access_token_expire_minutes": 30,
    "email_token_expire_minutes": 30,
    "trys_before_lock": 5,
    "trusted_browser_origins": "https://app.example.com",
    "redis_host": "r",
    "redis_port": 6379,
    "redis_db": 0,
    "postgres_user": "u",
    "postgres_password": "p",
    "postgres_server": "s",
    "postgres_port": 5432,
    "postgres_db": "d",
    "smtp_host": "m",
    "smtp_port": 1025,
    "smtp_user": "a@b.c",
    "smtp_password": "p",
    "smtp_from_email": "a@b.c",
    "smtp_from_name": "n",
    "smtp_tls": False,
    "smtp_ssl": False,
    "smtp_use_credentials": False,
}


class BootstrapRoutesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)

        def override_db():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)
        self.previous_settings = bootstrap_router.settings
        bootstrap_router.settings = SimpleNamespace(bootstrap_setup_token=None)
        # El rate limiting requiere Redis; aquí se prueba la lógica de Bootstrap. Se
        # desactiva sobre el singleton (el env por módulo no aplica por el cache).
        self._previous_rate_limit = settings.rate_limit_enabled
        settings.rate_limit_enabled = False

    def tearDown(self) -> None:
        app.dependency_overrides.clear()
        bootstrap_router.settings = self.previous_settings
        settings.rate_limit_enabled = self._previous_rate_limit

    def _payload(self) -> dict[str, object]:
        return {
            "user": {
                "name": "Admin",
                "last_name": "Platform",
                "email": "admin@example.com",
                "password": "admin-password-123",
                "confirm_password": "admin-password-123",
            },
            "system_admin_role": {
                "label": "Administrador de plataforma",
                "description": "Administracion inicial",
            },
            "additional_roles": [
                {
                    "name": "Operacion",
                    "description": "Rol operativo inicial",
                    "permissions": ["users:read"],
                    "assign_to_initial_user": True,
                }
            ],
        }

    def test_clean_database_status_requires_setup(self) -> None:
        response = self.client.get("/api/v1/bootstrap/status")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.json(), {"setup_required": True, "token_required": False})

    def test_openapi_exposes_bootstrap_routes(self) -> None:
        response = self.client.get("/api/openapi.json")

        self.assertEqual(response.status_code, 200)
        paths = response.json()["paths"]
        self.assertIn("/api/v1/bootstrap/status", paths)
        self.assertIn("/api/v1/bootstrap/catalog", paths)
        self.assertIn("/api/v1/bootstrap/initialize", paths)

    def test_completed_setup_status_does_not_expose_internal_state(self) -> None:
        with Session(self.engine) as session:
            session.add(PlatformSetup(id=1, status="completed", completion_origin="legacy"))
            session.commit()

        response = self.client.get("/api/v1/bootstrap/status")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"setup_required": False, "token_required": False})

    def test_pending_state_with_users_fails_safe(self) -> None:
        with Session(self.engine) as session:
            session.add(PlatformSetup(id=1, status="pending"))
            session.add(
                User(
                    name="Existing",
                    last_name="Admin",
                    email="existing@example.com",
                    is_active=True,
                    hashed_password="hash",
                    token="token",
                )
            )
            session.commit()

        status_response = self.client.get("/api/v1/bootstrap/status")
        init_response = self.client.post("/api/v1/bootstrap/initialize", json=self._payload())

        self.assertEqual(status_response.json(), {"setup_required": False, "token_required": False})
        self.assertEqual(init_response.status_code, 409)

    def test_catalog_only_before_setup(self) -> None:
        response = self.client.get("/api/v1/bootstrap/catalog")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["limits"], {"max_additional_roles": 10})
        self.assertEqual([group["name"] for group in body["permission_groups"]], ["users", "roles", "permissions", "system_settings", "backups", "audit_events"])
        self.assertIn("users:read", {item["access"] for group in body["permission_groups"] for item in group["permissions"]})

        with Session(self.engine) as session:
            session.add(PlatformSetup(id=1, status="completed", completion_origin="legacy"))
            session.commit()
        closed_response = self.client.get("/api/v1/bootstrap/catalog")
        self.assertEqual(closed_response.status_code, 409)
        self.assertEqual(closed_response.json()["code"], "bootstrap_completed")

    def test_initialize_without_token_completes_setup_without_session_material(self) -> None:
        response = self.client.post("/api/v1/bootstrap/initialize", json=self._payload())

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.json(), {"setup_complete": True})
        self.assertNotIn("set-cookie", response.headers)

        with Session(self.engine) as session:
            setup = session.get(PlatformSetup, 1)
            users = session.exec(select(User)).all()
            roles = session.exec(select(Role)).all()
            user_roles = session.exec(select(UserRole)).all()
            system_permissions = session.exec(
                select(RoleAccess.access).where(RoleAccess.role_id == setup.system_admin_role_id)
            ).all()

        self.assertEqual(setup.status, "completed")
        self.assertEqual(setup.completion_origin, "bootstrap")
        self.assertEqual(len(users), 1)
        self.assertNotEqual(users[0].hashed_password, "admin-password-123")
        self.assertEqual(len(roles), 2)
        self.assertEqual(len(user_roles), 2)
        self.assertEqual(set(system_permissions), declared_permissions())

    def test_token_is_required_when_configured(self) -> None:
        bootstrap_router.settings = SimpleNamespace(
            bootstrap_setup_token=SecretStr("valid-bootstrap-token-123")
        )

        missing = self.client.post("/api/v1/bootstrap/initialize", json=self._payload())
        wrong = self.client.post(
            "/api/v1/bootstrap/initialize",
            json=self._payload(),
            headers={"X-Bootstrap-Token": "wrong"},
        )
        ok = self.client.post(
            "/api/v1/bootstrap/initialize",
            json=self._payload(),
            headers={"X-Bootstrap-Token": "valid-bootstrap-token-123"},
        )

        self.assertEqual(missing.status_code, 403)
        self.assertEqual(wrong.status_code, 403)
        self.assertEqual(ok.status_code, 201)

    def test_invalid_permission_and_second_initialize_are_rejected(self) -> None:
        payload = self._payload()
        payload["additional_roles"] = [{"name": "Operacion", "permissions": ["invalid:permission"]}]

        invalid = self.client.post("/api/v1/bootstrap/initialize", json=payload)
        first = self.client.post("/api/v1/bootstrap/initialize", json=self._payload())
        second = self.client.post("/api/v1/bootstrap/initialize", json=self._payload())

        self.assertEqual(invalid.status_code, 422)
        invalid_body = invalid.json()
        # Error de dominio: envelope con código y mensaje seguro, sin lista de campos.
        # El wizard depende de esta forma para mostrar el mensaje real (no el genérico).
        self.assertEqual(invalid_body["code"], "invalid_permission")
        self.assertTrue(invalid_body["message"])
        self.assertNotIn("errors", invalid_body)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 409)

    def test_production_requires_valid_bootstrap_setup_token(self) -> None:
        with self.assertRaises(ValidationError):
            Settings(environment="production", app_encryption_key=SecretStr("x" * 44), **BASE_SETTINGS)
        with self.assertRaises(ValidationError):
            Settings(
                environment="production",
                bootstrap_setup_token="short",
                app_encryption_key=SecretStr("x" * 44),
                **BASE_SETTINGS,
            )

        settings = Settings(
            environment="production",
            bootstrap_setup_token="valid-bootstrap-token-123",
            app_encryption_key=SecretStr("x" * 44),
            **BASE_SETTINGS,
        )
        self.assertEqual(settings.bootstrap_setup_token.get_secret_value(), "valid-bootstrap-token-123")


if __name__ == "__main__":
    unittest.main()
