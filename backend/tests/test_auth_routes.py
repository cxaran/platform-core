import os
import unittest

from fastapi.testclient import TestClient


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

from backend.app.main import app  # noqa: E402


client = TestClient(app)


class AuthRoutesTest(unittest.TestCase):
    def test_openapi_exposes_auth_routes(self) -> None:
        response = client.get("/api/openapi.json")

        self.assertEqual(response.status_code, 200)

        paths = response.json()["paths"]

        self.assertIn("/api/v1/auth/login", paths)
        self.assertIn("/api/v1/auth/me", paths)
        self.assertIn("/api/v1/auth/register/request", paths)
        self.assertIn("/api/v1/auth/register/complete", paths)
        self.assertIn("/api/v1/auth/unlock", paths)

    def test_openapi_does_not_expose_unimplemented_auth_routes(self) -> None:
        response = client.get("/api/openapi.json")

        self.assertEqual(response.status_code, 200)

        paths = response.json()["paths"]

        self.assertNotIn("/api/v1/auth/refresh", paths)
        self.assertNotIn("/api/v1/auth/logout", paths)
        self.assertFalse(any("/auth/auth/" in path for path in paths))

    def test_me_requires_authentication(self) -> None:
        response = client.get("/api/v1/auth/me")

        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
