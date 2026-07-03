"""Tests del inicio de sesión con Google (OIDC) sobre sqlite.

El intercambio con Google se aísla parcheando ``exchange_code`` (el perfil ya
verificado es el contrato de esa función) y el state vive en un almacén en
memoria con el mismo contrato que Redis. Cubre: start deshabilitado/habilitado,
state de consumo único, login por identidad vinculada, vínculo por correo
verificado, alta gobernada por el registro público (doble candado) y el flag
efectivo en /auth/policy.
"""

import os
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

from cryptography.fernet import Fernet  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from pydantic import SecretStr  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from backend.app.auth import google_login  # noqa: E402
from backend.app.auth.auth import SESSION_COOKIE_KEY  # noqa: E402
from backend.app.auth.google_login import GoogleLoginError, GoogleProfile  # noqa: E402
from backend.app.core.database import get_db  # noqa: E402
from backend.app.core.settings import settings  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.app.models import Base  # noqa: E402
from backend.app.models.system_settings import SystemSettings  # noqa: E402
from backend.app.models.user import User  # noqa: E402
from backend.app.models.user_identity import UserIdentity  # noqa: E402

PROFILE = GoogleProfile(
    subject="google-sub-123",
    email="persona@example.com",
    given_name="Persona",
    family_name="Ejemplo",
)


class GoogleLoginTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        Base.metadata.create_all(self.engine)

        def override_db():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app, follow_redirects=False)

        self._previous_rate_limit = settings.rate_limit_enabled
        settings.rate_limit_enabled = False

        self.states: dict[str, str] = {}

        def store(state: str, nonce: str) -> None:
            self.states[state] = nonce

        def consume(state: str):
            return self.states.pop(state, None)

        self._patches = [
            mock.patch.object(google_login, "_store_state", store),
            mock.patch.object(google_login, "_consume_state", consume),
            mock.patch.object(
                settings, "app_encryption_key", SecretStr(Fernet.generate_key().decode())
            ),
        ]
        for patch in self._patches:
            patch.start()

    def tearDown(self) -> None:
        for patch in self._patches:
            patch.stop()
        settings.rate_limit_enabled = self._previous_rate_limit
        app.dependency_overrides.clear()

    def _seed(self, *, enabled: bool = True, registration: bool = False) -> None:
        from backend.app.services.secret_cipher import encrypt_secret

        with Session(self.engine) as session:
            session.add(
                SystemSettings(
                    google_login_enabled=enabled,
                    google_auth_client_id="client-id.apps.googleusercontent.com" if enabled else None,
                    google_auth_client_secret_ciphertext=(
                        encrypt_secret("client-secret") if enabled else None
                    ),
                    public_registration_enabled=registration,
                )
            )
            session.commit()

    def _seed_user(self, email: str, *, subject: str | None = None) -> uuid.UUID:
        with Session(self.engine) as session:
            user = User(
                name="Persona",
                last_name="Existente",
                email=email,
                is_active=True,
                hashed_password="x",
                token="t-" + uuid.uuid4().hex,
            )
            session.add(user)
            session.flush()
            if subject:
                session.add(
                    UserIdentity(
                        provider="google", subject=subject, user_id=user.id, email_at_link=email
                    )
                )
            session.commit()
            return user.id

    def _callback(self, profile=PROFILE, *, error: str | None = None):
        """Simula el aterrizaje del callback con un state válido recién emitido."""
        start = self.client.get("/api/v1/auth/google/start")
        self.assertEqual(start.status_code, 302, start.text)
        state = next(iter(self.states))

        async def fake_exchange(session, request, code, nonce):
            if error:
                raise GoogleLoginError(error)
            return profile

        with mock.patch.object(google_login, "exchange_code", fake_exchange):
            return self.client.get(
                f"/api/v1/auth/google/callback?code=fake-code&state={state}"
            )

    # -- start ---------------------------------------------------------------------

    def test_start_is_404_when_disabled(self) -> None:
        self._seed(enabled=False)
        self.assertEqual(self.client.get("/api/v1/auth/google/start").status_code, 404)

    def test_start_redirects_to_google_with_single_use_state(self) -> None:
        self._seed()
        response = self.client.get("/api/v1/auth/google/start")
        self.assertEqual(response.status_code, 302)
        location = response.headers["location"]
        self.assertTrue(location.startswith("https://accounts.google.com/o/oauth2/v2/auth?"))
        self.assertIn("scope=openid+email+profile", location)
        self.assertEqual(len(self.states), 1)
        state = next(iter(self.states))
        self.assertIn(f"state={state}", location)

    # -- callback ------------------------------------------------------------------

    def test_callback_rejects_unknown_or_reused_state(self) -> None:
        self._seed()
        response = self.client.get(
            "/api/v1/auth/google/callback?code=x&state=desconocido"
        )
        self.assertEqual(response.status_code, 302)
        self.assertIn("/login?error=google", response.headers["location"])
        self.assertNotIn(SESSION_COOKIE_KEY, self.client.cookies)

    def test_linked_identity_logs_in(self) -> None:
        self._seed()
        self._seed_user(PROFILE.email, subject=PROFILE.subject)
        response = self._callback()
        self.assertEqual(response.status_code, 302, response.text)
        self.assertTrue(response.headers["location"].endswith("/"))
        self.assertIn(SESSION_COOKIE_KEY, self.client.cookies)

    def test_verified_email_links_existing_account(self) -> None:
        self._seed()
        user_id = self._seed_user(PROFILE.email)
        response = self._callback()
        self.assertEqual(response.status_code, 302)
        self.assertIn(SESSION_COOKIE_KEY, self.client.cookies)
        with Session(self.engine) as session:
            identity = session.exec(select(UserIdentity)).one()
            self.assertEqual(identity.user_id, user_id)
            self.assertEqual(identity.subject, PROFILE.subject)

    def test_new_account_requires_effective_public_registration(self) -> None:
        self._seed(registration=False)
        response = self._callback()
        self.assertIn("/login?error=google", response.headers["location"])
        self.assertNotIn(SESSION_COOKIE_KEY, self.client.cookies)
        with Session(self.engine) as session:
            self.assertEqual(session.exec(select(User)).all(), [])

    def test_new_account_created_active_without_roles(self) -> None:
        self._seed(registration=True)
        response = self._callback()
        self.assertEqual(response.status_code, 302, response.text)
        self.assertIn(SESSION_COOKIE_KEY, self.client.cookies)
        with Session(self.engine) as session:
            user = session.exec(select(User)).one()
            self.assertEqual(user.email, PROFILE.email)
            self.assertTrue(user.is_active)
            identity = session.exec(select(UserIdentity)).one()
            self.assertEqual(identity.user_id, user.id)
            # Activo pero SIN roles (sin acceso hasta que un administrador lo
            # asigne), idéntico al registro por correo. La resolución de la
            # sesión por cookie se cubre en el E2E (sqlite no compara UUIDs
            # en string como Postgres).
            from backend.app.models.user import UserRole

            self.assertEqual(
                session.exec(select(UserRole).where(UserRole.user_id == user.id)).all(),
                [],
            )

    def test_exchange_failure_redirects_generically(self) -> None:
        self._seed(registration=True)
        response = self._callback(error="google_email_unverified")
        self.assertIn("/login?error=google", response.headers["location"])
        self.assertNotIn(SESSION_COOKIE_KEY, self.client.cookies)

    # -- policy --------------------------------------------------------------------

    def test_policy_exposes_effective_google_flag(self) -> None:
        self._seed(enabled=True)
        policy = self.client.get("/api/v1/auth/policy").json()
        self.assertTrue(policy["google_login_enabled"])

    def test_policy_flag_off_without_credentials(self) -> None:
        # Flag encendido pero SIN credenciales: la política efectiva es apagado.
        with Session(self.engine) as session:
            session.add(SystemSettings(google_login_enabled=True))
            session.commit()
        policy = self.client.get("/api/v1/auth/policy").json()
        self.assertFalse(policy["google_login_enabled"])


if __name__ == "__main__":
    unittest.main()
