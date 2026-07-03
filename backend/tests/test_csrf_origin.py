import os
import unittest
import uuid


DEV_ENV = {
    "ENVIRONMENT": "local",
    "SECRET_KEY": "test-secret-key",
    "ACCESS_TOKEN_EXPIRE_MINUTES": "30",
    "EMAIL_TOKEN_EXPIRE_MINUTES": "30",
    "TRYS_BEFORE_LOCK": "5",
    "TRUSTED_BROWSER_ORIGINS": "http://localhost:3000",
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

from pydantic import SecretStr, ValidationError  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from backend.app.auth.auth_dependencies import get_current_user  # noqa: E402
from backend.app.core.csrf import _origin_from_referer, normalize_browser_origin  # noqa: E402
from backend.app.core.settings import Settings  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.app.schemas.user import SessionUser  # noqa: E402


client = TestClient(app)

ALLOWED = "http://localhost:3000"
EXTERNAL = "http://evil.test"

BASE_SETTINGS = {
    "secret_key": "k",
    "access_token_expire_minutes": 30,
    "email_token_expire_minutes": 30,
    "trys_before_lock": 5,
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


class NormalizeOriginTest(unittest.TestCase):
    def test_default_port_matches_explicit_port(self) -> None:
        self.assertEqual(
            normalize_browser_origin("https://app.example.com"),
            normalize_browser_origin("https://app.example.com:443"),
        )

    def test_rejects_null_wildcard_empty(self) -> None:
        for value in ("null", "*", "", "   "):
            self.assertIsNone(normalize_browser_origin(value))

    def test_rejects_path_query_fragment(self) -> None:
        for value in (
            "https://app.example.com/path",
            "https://app.example.com?x=1",
            "https://app.example.com#a",
        ):
            self.assertIsNone(normalize_browser_origin(value))

    def test_rejects_userinfo(self) -> None:
        self.assertIsNone(normalize_browser_origin("https://app.example.com@evil.test"))

    def test_rejects_missing_scheme_or_host(self) -> None:
        for value in ("app.example.com", "http://", "ftp://app.example.com"):
            self.assertIsNone(normalize_browser_origin(value))

    def test_lookalike_domain_is_distinct(self) -> None:
        self.assertNotEqual(
            normalize_browser_origin("https://app.example.com"),
            normalize_browser_origin("https://app.example.com.evil.test"),
        )

    def test_referer_reduces_to_origin(self) -> None:
        self.assertEqual(
            _origin_from_referer("http://localhost:3000/resources/users?x=1"),
            normalize_browser_origin("http://localhost:3000"),
        )


class SettingsOriginsValidationTest(unittest.TestCase):
    def test_production_empty_origins_fails(self) -> None:
        with self.assertRaises(ValidationError):
            Settings(environment="production", trusted_browser_origins="", **BASE_SETTINGS)

    def test_production_http_origin_fails(self) -> None:
        with self.assertRaises(ValidationError):
            Settings(
                environment="production",
                trusted_browser_origins="http://app.example.com",
                **BASE_SETTINGS,
            )

    def test_production_https_origin_ok(self) -> None:
        settings = Settings(
            environment="production",
            trusted_browser_origins="https://app.example.com",
            bootstrap_setup_token="valid-bootstrap-token-123",
            app_encryption_key=SecretStr("x" * 44),
            **BASE_SETTINGS,
        )
        self.assertEqual(settings.trusted_origins, frozenset({"https://app.example.com:443"}))

    def test_local_default_ok(self) -> None:
        settings = Settings(environment="local", **BASE_SETTINGS)
        self.assertIn("http://localhost:3000", settings.trusted_origins)


def session_user(*permissions: str) -> SessionUser:
    return SessionUser(
        id=uuid.uuid4(),
        name="Tester",
        last_name="Apellido",
        email="tester@example.com",
        permissions=set(permissions),
    )


def headers(
    *, origin: str | None = None, referer: str | None = None, cookie: bool = True, bearer: bool = False
) -> dict[str, str]:
    result: dict[str, str] = {}
    if cookie:
        result["Cookie"] = "session_token=fake-token"
    if origin is not None:
        result["Origin"] = origin
    if referer is not None:
        result["Referer"] = referer
    if bearer:
        result["Authorization"] = "Bearer fake-token"
    return result


class GuardEndpointTest(unittest.TestCase):
    def _code(self, response) -> str:
        try:
            return response.json().get("code", "")
        except ValueError:
            return ""

    def test_external_origin_blocks_post_users(self) -> None:
        response = client.post("/api/v1/users", headers=headers(origin=EXTERNAL), json={})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self._code(response), "csrf_origin_invalid")

    def test_403_body_is_exact_and_minimal(self) -> None:
        response = client.post("/api/v1/users", headers=headers(origin=EXTERNAL), json={})
        self.assertEqual(
            response.json(),
            {"code": "csrf_origin_invalid", "message": "Solicitud no disponible."},
        )

    def test_allowed_origin_passes_guard(self) -> None:
        response = client.post("/api/v1/users", headers=headers(origin=ALLOWED), json={})
        self.assertNotEqual(self._code(response), "csrf_origin_invalid")

    def test_allowed_referer_without_origin_passes_guard(self) -> None:
        response = client.post(
            "/api/v1/users",
            headers=headers(referer=f"{ALLOWED}/resources/users"),
            json={},
        )
        self.assertNotEqual(self._code(response), "csrf_origin_invalid")

    def test_no_origin_no_referer_blocks(self) -> None:
        response = client.post("/api/v1/users", headers=headers(), json={})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self._code(response), "csrf_origin_invalid")

    def test_roles_external_origin_blocks(self) -> None:
        response = client.post("/api/v1/roles", headers=headers(origin=EXTERNAL), json={})
        self.assertEqual(self._code(response), "csrf_origin_invalid")

    def test_patch_and_delete_external_origin_blocks(self) -> None:
        item = f"/api/v1/users/{uuid.uuid4()}"
        patch = client.patch(item, headers=headers(origin=EXTERNAL), json={})
        delete = client.delete(item, headers=headers(origin=EXTERNAL))
        self.assertEqual(self._code(patch), "csrf_origin_invalid")
        self.assertEqual(self._code(delete), "csrf_origin_invalid")

    def test_get_with_cookie_no_origin_not_blocked(self) -> None:
        response = client.get("/api/v1/resources", headers=headers())
        self.assertNotEqual(self._code(response), "csrf_origin_invalid")

    def test_bearer_without_origin_not_blocked(self) -> None:
        response = client.post(
            "/api/v1/users", headers=headers(cookie=False, bearer=True), json={}
        )
        self.assertNotEqual(self._code(response), "csrf_origin_invalid")

    def test_public_login_without_cookie_not_blocked(self) -> None:
        response = client.post("/api/v1/auth/login", headers=headers(cookie=False), json={})
        self.assertNotEqual(self._code(response), "csrf_origin_invalid")

    def test_public_register_without_cookie_not_blocked(self) -> None:
        response = client.post(
            "/api/v1/auth/register/request", headers=headers(cookie=False), json={}
        )
        self.assertNotEqual(self._code(response), "csrf_origin_invalid")

    def test_pass_through_reaches_endpoint_validation(self) -> None:
        app.dependency_overrides[get_current_user] = lambda: session_user("users:create")
        try:
            response = client.post("/api/v1/users", headers=headers(origin=ALLOWED), json={})
        finally:
            app.dependency_overrides.pop(get_current_user, None)
        # Pasó el guard y la auth/permiso; el endpoint valida el cuerpo vacío.
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self._code(response), "validation_error")


if __name__ == "__main__":
    unittest.main()
