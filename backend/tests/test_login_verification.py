"""Tests del segundo paso de login verificado por correo (código/enlace).

Flujo completo con TestClient sobre sqlite y el almacén del reto FALSIFICADO en
memoria (mismo contrato que Redis): modo apagado, reto por código, consumo
único, tope de intentos, modo enlace y el BYPASS de los usuarios con cobertura
administrativa completa (la garantía anti-bloqueo). El correo se captura con un
mock del transporte para extraer el secreto como lo haría el usuario.
"""

import os
import re
import unittest
import uuid
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

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlmodel import Session  # noqa: E402

from backend.app.auth import login_verification  # noqa: E402
from backend.app.auth.auth import SESSION_COOKIE_KEY  # noqa: E402
from backend.app.auth.login_verification import CHALLENGE_COOKIE_KEY  # noqa: E402
from pydantic import SecretStr  # noqa: E402

from backend.app.auth.security import get_password_hash  # noqa: E402
from backend.app.core.database import get_db  # noqa: E402
from backend.app.core.settings import settings  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.app.models import Base  # noqa: E402
from backend.app.models.system_settings import SystemSettings  # noqa: E402
from backend.app.models.user import Role, RoleAccess, User, UserRole  # noqa: E402
from backend.app.security.catalog import declared_permissions  # noqa: E402

ADMIN_EMAIL = "admin@example.com"
MEMBER_EMAIL = "member@example.com"
PASSWORD = "Password-123"


class _FakeChallengeStore:
    """Contrato de Redis del reto, en memoria (challenge_id -> valor, intentos)."""

    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.attempts: dict[str, int] = {}

    def store(
        self,
        challenge_id: str,
        user_id: str,
        secret_hash: str,
        ttl_seconds: int | None = None,
    ) -> None:
        self.values[challenge_id] = f"{user_id}:{secret_hash}"

    def load(self, challenge_id: str):
        raw = self.values.get(challenge_id)
        if raw is None:
            return None
        user_id, _, secret_hash = raw.partition(":")
        return user_id, secret_hash

    def delete(self, challenge_id: str) -> None:
        self.values.pop(challenge_id, None)
        self.attempts.pop(challenge_id, None)

    def bump(self, challenge_id: str) -> int:
        self.attempts[challenge_id] = self.attempts.get(challenge_id, 0) + 1
        return self.attempts[challenge_id]


class LoginVerificationTest(unittest.TestCase):
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

        self.store = _FakeChallengeStore()
        self._patches = [
            mock.patch.object(login_verification, "_store_challenge", self.store.store),
            mock.patch.object(login_verification, "_load_challenge", self.store.load),
            mock.patch.object(login_verification, "_delete_challenge", self.store.delete),
            mock.patch.object(login_verification, "_bump_attempts", self.store.bump),
            mock.patch(
                "backend.app.services.email_service._send_via_fastapi_mail",
                new_callable=mock.AsyncMock,
            ),
            # El contador de intentos fallidos de contraseña vive en Redis y es
            # ortogonal a este flujo: se anula para mantener el test hermético.
            mock.patch(
                "backend.app.auth.auth.clear_failed_login_attempts", lambda user: None
            ),
            mock.patch(
                "backend.app.auth.auth.increment_failed_login_attempts",
                new_callable=mock.AsyncMock,
            ),
        ]
        started = [patch.start() for patch in self._patches]
        self.send_mail = started[4]

    def tearDown(self) -> None:
        for patch in self._patches:
            patch.stop()
        settings.rate_limit_enabled = self._previous_rate_limit
        app.dependency_overrides.clear()

    def _seed(self, *, mode: str) -> None:
        with Session(self.engine) as session:
            session.add(SystemSettings(login_verification_mode=mode))

            admin = User(
                name="Admin",
                last_name="Total",
                email=ADMIN_EMAIL,
                is_active=True,
                hashed_password=get_password_hash(SecretStr(PASSWORD)),
                token="admin-token-" + uuid.uuid4().hex,
            )
            member = User(
                name="Member",
                last_name="Normal",
                email=MEMBER_EMAIL,
                is_active=True,
                hashed_password=get_password_hash(SecretStr(PASSWORD)),
                token="member-token-" + uuid.uuid4().hex,
            )
            role = Role(name="Administrador", description="", is_active=True)
            session.add_all([admin, member, role])
            session.flush()
            for permission in sorted(declared_permissions()):
                session.add(RoleAccess(role_id=role.id, access=permission, is_active=True))
            session.add(UserRole(user_id=admin.id, role_id=role.id))
            session.commit()

    def _login(self, email: str):
        return self.client.post(
            "/api/v1/auth/login", json={"email": email, "password": PASSWORD}
        )

    def _sent_secret(self) -> str:
        """Extrae el código/token del último correo enviado, como lo leería el usuario."""
        assert self.send_mail.await_args is not None
        message = self.send_mail.await_args.kwargs["message"]
        code = re.search(r"código de inicio de sesión es: (\S+)", message)
        if code:
            return code.group(1)
        link = re.search(r"token=([A-Za-z0-9_\-]+)", message)
        assert link, message
        return link.group(1)

    # -- Modo apagado -----------------------------------------------------------------

    def test_disabled_mode_logs_in_directly(self) -> None:
        self._seed(mode="disabled")
        response = self._login(MEMBER_EMAIL)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()["verification_required"])
        self.assertIn(SESSION_COOKIE_KEY, self.client.cookies)
        self.send_mail.assert_not_awaited()

    # -- Reto por código ----------------------------------------------------------------

    def test_code_mode_challenges_and_verifies(self) -> None:
        self._seed(mode="code")
        response = self._login(MEMBER_EMAIL)
        body = response.json()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(body["verification_required"])
        self.assertEqual(body["verification_mode"], "code")
        # Sin sesión aún; el reto viaja en su propia cookie de navegador.
        self.assertNotIn(SESSION_COOKIE_KEY, self.client.cookies)
        self.assertIn(CHALLENGE_COOKIE_KEY, self.client.cookies)

        code = self._sent_secret()
        self.assertRegex(code, r"^\d{6}$")

        wrong = self.client.post("/api/v1/auth/login/verify", json={"code": "000000" if code != "000000" else "111111"})
        self.assertEqual(wrong.status_code, 400)
        self.assertNotIn(SESSION_COOKIE_KEY, self.client.cookies)

        ok = self.client.post("/api/v1/auth/login/verify", json={"code": code})
        self.assertEqual(ok.status_code, 200, ok.text)
        self.assertIn(SESSION_COOKIE_KEY, self.client.cookies)

        # Consumo único: el mismo código ya no sirve.
        self.client.cookies.delete(SESSION_COOKIE_KEY)
        reuse = self.client.post("/api/v1/auth/login/verify", json={"code": code})
        self.assertEqual(reuse.status_code, 400)

    def test_verify_requires_same_browser_challenge_cookie(self) -> None:
        self._seed(mode="code")
        self._login(MEMBER_EMAIL)
        code = self._sent_secret()
        # Otro "navegador" (cliente sin la cookie del reto) no puede canjear el secreto.
        other = TestClient(app)
        response = other.post("/api/v1/auth/login/verify", json={"code": code})
        self.assertEqual(response.status_code, 400)
        self.assertNotIn(SESSION_COOKIE_KEY, other.cookies)

    def test_attempt_cap_destroys_the_challenge(self) -> None:
        self._seed(mode="code")
        self._login(MEMBER_EMAIL)
        code = self._sent_secret()
        for _ in range(login_verification.MAX_VERIFY_ATTEMPTS):
            self.client.post("/api/v1/auth/login/verify", json={"code": "999999"})
        # Tope agotado: incluso el código correcto queda inservible.
        response = self.client.post("/api/v1/auth/login/verify", json={"code": code})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.store.values, {})

    # -- Reto por enlace ----------------------------------------------------------------

    def test_link_mode_sends_link_token_and_verifies(self) -> None:
        self._seed(mode="link")
        response = self._login(MEMBER_EMAIL)
        self.assertTrue(response.json()["verification_required"])
        self.assertEqual(response.json()["verification_mode"], "link")

        assert self.send_mail.await_args is not None
        message = self.send_mail.await_args.kwargs["message"]
        self.assertIn("/login/verify?token=", message)
        token = self._sent_secret()

        ok = self.client.post("/api/v1/auth/login/verify", json={"code": token})
        self.assertEqual(ok.status_code, 200, ok.text)
        self.assertIn(SESSION_COOKIE_KEY, self.client.cookies)

    # -- Bypass administrativo -----------------------------------------------------------

    def test_full_admin_coverage_never_verifies(self) -> None:
        self._seed(mode="code")
        response = self._login(ADMIN_EMAIL)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json()["verification_required"])
        self.assertIn(SESSION_COOKIE_KEY, self.client.cookies)
        self.send_mail.assert_not_awaited()

    def test_email_failure_is_an_honest_error_without_challenge(self) -> None:
        self._seed(mode="code")
        self.send_mail.side_effect = RuntimeError("smtp down")
        response = self._login(MEMBER_EMAIL)
        self.assertEqual(response.status_code, 503)
        self.assertIn("login_verification_email_failed", response.text)
        self.assertNotIn(SESSION_COOKIE_KEY, self.client.cookies)
        self.assertEqual(self.store.values, {})


if __name__ == "__main__":
    unittest.main()
