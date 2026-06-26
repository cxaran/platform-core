import os
import unittest
from unittest.mock import AsyncMock, patch

os.environ.update(
    {
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
)

from fastapi.testclient import TestClient  # noqa: E402

from backend.app.api.v1 import auth as auth_router  # noqa: E402
from backend.app.core.settings import settings  # noqa: E402
from backend.app.main import app  # noqa: E402


class AuthPolicyTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        self._prev = {
            "rate_limit_enabled": settings.rate_limit_enabled,
            "registration_enabled": settings.registration_enabled,
            "password_reset_enabled": settings.password_reset_enabled,
        }
        settings.rate_limit_enabled = False
        settings.registration_enabled = False
        settings.password_reset_enabled = True

    def tearDown(self) -> None:
        for key, value in self._prev.items():
            setattr(settings, key, value)

    def test_policy_endpoint_publishes_only_two_booleans(self) -> None:
        body = self.client.get("/api/v1/auth/policy").json()
        self.assertEqual(
            body, {"registration_enabled": False, "password_reset_enabled": True}
        )

    def test_register_request_blocked_when_disabled(self) -> None:
        response = self.client.post(
            "/api/v1/auth/register/request", json={"email": "new@example.com"}
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "registration_disabled")

    def test_register_complete_blocked_when_disabled(self) -> None:
        response = self.client.post(
            "/api/v1/auth/register/complete",
            json={
                "first_name": "Nuevo",
                "last_name": "Usuario",
                "token": "0123456789",
                "email": "new@example.com",
                "password": "new-password-123",
                "confirm_password": "new-password-123",
            },
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "registration_disabled")

    def test_register_request_passes_guard_when_enabled(self) -> None:
        settings.registration_enabled = True
        with patch.object(
            auth_router, "send_registration_token", new=AsyncMock(return_value=None)
        ):
            response = self.client.post(
                "/api/v1/auth/register/request", json={"email": "new@example.com"}
            )
        # No revela existencia de la cuenta (anti-enumeración).
        self.assertEqual(response.status_code, 202)

    def test_password_reset_blocked_when_disabled(self) -> None:
        settings.password_reset_enabled = False
        response = self.client.post(
            "/api/v1/auth/password/forgot", json={"email": "user@example.com"}
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "password_reset_disabled")


if __name__ == "__main__":
    unittest.main()
