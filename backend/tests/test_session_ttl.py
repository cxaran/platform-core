"""Duración de sesión y renovación deslizante.

- Toda sesión dura ``access_token_expire_minutes`` (no hay tipos de sesión:
  el core es una plataforma de administración, sin "clientes").
- Cualquier sesión válida pasada la mitad de su vida se renueva sola con el
  mismo ttl/jti (middleware deslizante) — el usuario activo no es expulsado
  a media jornada.
"""

import os
import re
import unittest
import uuid
from datetime import timedelta, timezone
from unittest import mock

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

import jwt  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from pydantic import SecretStr  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlmodel import Session  # noqa: E402

from backend.app.auth.security import get_password_hash  # noqa: E402
from backend.app.core.database import get_db  # noqa: E402
from backend.app.core.settings import settings  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.app.models import Base  # noqa: E402
from backend.app.models.user import User  # noqa: E402
from backend.app.utils.utc_now import utc_now  # noqa: E402

PASSWORD = "S3cret!password"


def _max_age(set_cookie_headers: list[str]) -> int:
    for header in set_cookie_headers:
        if header.startswith("session_token="):
            match = re.search(r"Max-Age=(\d+)", header, re.IGNORECASE)
            assert match is not None, header
            return int(match.group(1))
    raise AssertionError(f"sin cookie de sesión en {set_cookie_headers}")


class SessionTtlTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        Base.metadata.create_all(self.engine)

        def override_db():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)
        self._previous_rate_limit = settings.rate_limit_enabled
        settings.rate_limit_enabled = False

        # El contador de intentos fallidos vive en Redis y es ortogonal aquí.
        self._patches = [
            mock.patch("backend.app.auth.auth.clear_failed_login_attempts", lambda user: None),
            mock.patch(
                "backend.app.auth.auth.increment_failed_login_attempts",
                new_callable=mock.AsyncMock,
            ),
        ]
        for patch in self._patches:
            patch.start()

        with Session(self.engine) as session:
            self.user_email = "usuario@example.com"
            session.add(self._user(self.user_email))
            session.commit()

    def tearDown(self) -> None:
        for patch in self._patches:
            patch.stop()
        settings.rate_limit_enabled = self._previous_rate_limit
        app.dependency_overrides.clear()

    @staticmethod
    def _user(email: str) -> User:
        return User(
            name="Test",
            last_name="User",
            email=email,
            hashed_password=get_password_hash(SecretStr(PASSWORD)),
            token=uuid.uuid4().hex,
        )

    def _login(self, email: str):
        response = self.client.post(
            "/api/v1/auth/login", json={"email": email, "password": PASSWORD}
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response

    def test_login_session_uses_deployment_ttl(self) -> None:
        response = self._login(self.user_email)
        max_age = _max_age(response.headers.get_list("set-cookie"))
        self.assertEqual(max_age, settings.access_token_expire_minutes * 60)

    def test_sliding_renewal_past_half_life(self) -> None:
        """Un token válido pasada la mitad de su vida se renueva con igual ttl."""
        now = utc_now().replace(tzinfo=timezone.utc)
        ttl = timedelta(minutes=30)
        old = jwt.encode(
            {
                "sub": str(uuid.uuid4()),
                "iat": int((now - timedelta(minutes=20)).timestamp()),
                "exp": int((now + timedelta(minutes=10)).timestamp()),
                "jti": "versión-x",
            },
            settings.secret_key.get_secret_value(),
            algorithm=settings.algorithm,
        )
        response = self.client.get("/api/openapi.json", cookies={"session_token": old})
        headers = response.headers.get_list("set-cookie")
        self.assertEqual(_max_age(headers), int(ttl.total_seconds()))
        renewed = next(h for h in headers if h.startswith("session_token=")).split(";")[0]
        payload = jwt.decode(
            renewed.removeprefix("session_token="),
            settings.secret_key.get_secret_value(),
            algorithms=[settings.algorithm],
        )
        self.assertEqual(payload["jti"], "versión-x")
        self.assertGreaterEqual(payload["exp"], int((now + timedelta(minutes=29)).timestamp()))

    def test_fresh_token_is_not_renewed(self) -> None:
        now = utc_now().replace(tzinfo=timezone.utc)
        fresh = jwt.encode(
            {
                "sub": str(uuid.uuid4()),
                "iat": int(now.timestamp()),
                "exp": int((now + timedelta(minutes=30)).timestamp()),
                "jti": "v",
            },
            settings.secret_key.get_secret_value(),
            algorithm=settings.algorithm,
        )
        response = self.client.get("/api/openapi.json", cookies={"session_token": fresh})
        session_cookies = [
            h for h in response.headers.get_list("set-cookie") if h.startswith("session_token=")
        ]
        self.assertEqual(session_cookies, [])

    def test_expired_token_is_not_renewed(self) -> None:
        now = utc_now().replace(tzinfo=timezone.utc)
        expired = jwt.encode(
            {
                "sub": str(uuid.uuid4()),
                "iat": int((now - timedelta(minutes=40)).timestamp()),
                "exp": int((now - timedelta(minutes=10)).timestamp()),
                "jti": "v",
            },
            settings.secret_key.get_secret_value(),
            algorithm=settings.algorithm,
        )
        response = self.client.get("/api/openapi.json", cookies={"session_token": expired})
        session_cookies = [
            h for h in response.headers.get_list("set-cookie") if h.startswith("session_token=")
        ]
        self.assertEqual(session_cookies, [])


if __name__ == "__main__":
    unittest.main()
