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
from backend.app.utils.base_url import normalize_base_url  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.app.schemas.user import SessionUser  # noqa: E402


client = TestClient(app)


class NormalizeBaseUrlTest(unittest.TestCase):
    def test_keeps_explicit_port_and_lowercases_host(self) -> None:
        self.assertEqual(
            normalize_base_url("http://Localhost:3000"), "http://localhost:3000"
        )

    def test_omits_port_when_absent(self) -> None:
        self.assertEqual(
            normalize_base_url("https://App.Example.com"), "https://app.example.com"
        )

    def test_accepts_trailing_slash_only(self) -> None:
        self.assertEqual(
            normalize_base_url("https://app.example.com/"), "https://app.example.com"
        )

    def test_rejects_path_query_fragment(self) -> None:
        for value in (
            "https://app.example.com/path",
            "https://app.example.com?x=1",
            "https://app.example.com#a",
        ):
            self.assertIsNone(normalize_base_url(value))

    def test_rejects_userinfo_scheme_and_empty(self) -> None:
        for value in (
            "https://user:pass@app.example.com",
            "ftp://app.example.com",
            "app.example.com",
            "",
            "   ",
        ):
            self.assertIsNone(normalize_base_url(value))


class PublicBaseUrlPolicyTest(unittest.TestCase):
    """`public_base_url_or_none` es la única puerta de escritura de app_base_url:
    formato de origen y, en producción, HTTPS obligatorio."""

    def test_production_requires_https(self) -> None:
        from backend.app.core.settings import settings
        from backend.app.services.system_settings_service import public_base_url_or_none

        previous = settings.environment
        settings.environment = "production"
        try:
            self.assertIsNone(public_base_url_or_none("http://app.example.com"))
            self.assertEqual(
                public_base_url_or_none("https://app.example.com"),
                "https://app.example.com",
            )
        finally:
            settings.environment = previous

    def test_local_accepts_http(self) -> None:
        from backend.app.services.system_settings_service import public_base_url_or_none

        self.assertEqual(
            public_base_url_or_none("http://localhost:8080"), "http://localhost:8080"
        )


def session_user(*permissions: str) -> SessionUser:
    return SessionUser(
        id=uuid.uuid4(),
        name="Tester",
        last_name="Apellido",
        email="tester@example.com",
        permissions=set(permissions),
    )


def headers(*, fetch_site: str | None = None, cookie: bool = True) -> dict[str, str]:
    result: dict[str, str] = {}
    if cookie:
        result["Cookie"] = "session_token=fake-token"
    if fetch_site is not None:
        result["Sec-Fetch-Site"] = fetch_site
    return result


class GuardEndpointTest(unittest.TestCase):
    """El guard rechaza mutaciones con cookie de sesión declaradas cross-site por
    el navegador (``Sec-Fetch-Site``); todo lo demás pasa (ver core/csrf.py)."""

    def _code(self, response) -> str:
        try:
            return response.json().get("code", "")
        except ValueError:
            return ""

    def test_cross_site_blocks_post_users(self) -> None:
        response = client.post(
            "/api/v1/users", headers=headers(fetch_site="cross-site"), json={}
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self._code(response), "csrf_origin_invalid")

    def test_403_body_is_exact_and_minimal(self) -> None:
        response = client.post(
            "/api/v1/users", headers=headers(fetch_site="cross-site"), json={}
        )
        self.assertEqual(
            response.json(),
            {"code": "csrf_origin_invalid", "message": "Solicitud no disponible."},
        )

    def test_same_origin_same_site_and_none_pass(self) -> None:
        for value in ("same-origin", "same-site", "none"):
            response = client.post(
                "/api/v1/users", headers=headers(fetch_site=value), json={}
            )
            self.assertNotEqual(self._code(response), "csrf_origin_invalid", value)

    def test_missing_header_passes_non_browser_clients(self) -> None:
        response = client.post("/api/v1/users", headers=headers(), json={})
        self.assertNotEqual(self._code(response), "csrf_origin_invalid")

    def test_cross_site_get_with_cookie_not_blocked(self) -> None:
        response = client.get(
            "/api/v1/resources", headers=headers(fetch_site="cross-site")
        )
        self.assertNotEqual(self._code(response), "csrf_origin_invalid")

    def test_cross_site_without_cookie_not_blocked(self) -> None:
        # Sin cookie no hay sesión que secuestrar (login público, clientes Bearer).
        response = client.post(
            "/api/v1/auth/login",
            headers=headers(fetch_site="cross-site", cookie=False),
            json={},
        )
        self.assertNotEqual(self._code(response), "csrf_origin_invalid")

    def test_patch_and_delete_cross_site_block(self) -> None:
        item = f"/api/v1/users/{uuid.uuid4()}"
        patch = client.patch(item, headers=headers(fetch_site="cross-site"), json={})
        delete = client.delete(item, headers=headers(fetch_site="cross-site"))
        self.assertEqual(self._code(patch), "csrf_origin_invalid")
        self.assertEqual(self._code(delete), "csrf_origin_invalid")

    def test_pass_through_reaches_endpoint_validation(self) -> None:
        app.dependency_overrides[get_current_user] = lambda: session_user("users:create")
        try:
            response = client.post(
                "/api/v1/users", headers=headers(fetch_site="same-origin"), json={}
            )
        finally:
            app.dependency_overrides.pop(get_current_user, None)
        # Pasó el guard y la auth/permiso; el endpoint valida el cuerpo vacío.
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self._code(response), "validation_error")


if __name__ == "__main__":
    unittest.main()
