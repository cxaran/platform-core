import base64
import json
import logging
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
from sqlmodel import Session  # noqa: E402

from backend.app.core.settings import settings  # noqa: E402

INTERNAL_SECRET = "internal-shared-secret-oauth-zzz"
settings.app_encryption_key = SecretStr(Fernet.generate_key().decode())
# OJO: ``settings`` es un singleton compartido por toda la suite. El secreto interno
# se fija en setUp de la clase de arriendo (no a nivel de módulo) para no pisar el
# valor que otros módulos esperan según el orden de import.
settings.rate_limit_enabled = False
settings.openai_oauth_client_id = "client-test-id"
settings.openai_oauth_redirect_uri = "http://localhost:3000/oauth/callback"
settings.openai_oauth_authorize_url = "https://auth.openai.com/oauth/authorize"
settings.openai_oauth_token_url = "https://auth.openai.com/oauth/token"
settings.openai_oauth_scope = "openid profile email offline_access"

from backend.app.agent import oauth as oauth_mod  # noqa: E402
from backend.app.agent.oauth import (  # noqa: E402
    _extract_account_id,
    code_challenge_s256,
    decode_oauth_profile,
    encode_oauth_profile,
    ensure_fresh_access_token,
    generate_code_verifier,
)
from backend.app.auth.auth_dependencies import get_current_user  # noqa: E402
from backend.app.core.database import get_db  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.app.models import Base  # noqa: E402
from backend.app.models.ai_provider_credential import AiProviderCredential  # noqa: E402
from backend.app.models.enums import AiCredentialType, AiProvider  # noqa: E402
from backend.app.schemas.user import SessionUser  # noqa: E402


BASE = "/api/v1/users/me/ai-providers/oauth/openai"
LEASE_URL = "/api/v1/internal/agent/credential-lease"


def _session_user(user_id: uuid.UUID) -> SessionUser:
    return SessionUser(
        id=user_id,
        name="Usuario",
        last_name="Tester",
        email=f"u-{user_id.hex[:8]}@example.com",
        permissions=set(),
    )


def _fake_id_token(account_id: str) -> str:
    """JWT falso (sin firma real) con el claim de cuenta de OpenAI."""

    def seg(obj: dict[str, object]) -> str:
        return base64.urlsafe_b64encode(json.dumps(obj).encode("utf-8")).rstrip(b"=").decode("ascii")

    header = seg({"alg": "RS256", "typ": "JWT"})
    payload = seg({"https://api.openai.com/auth": {"chatgpt_account_id": account_id}})
    return f"{header}.{payload}.signature-irrelevante"


class OAuthHelpersTest(unittest.TestCase):
    def test_pkce_challenge_is_s256_of_verifier(self) -> None:
        import hashlib

        verifier = generate_code_verifier()
        expected = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode("ascii")).digest()
        ).rstrip(b"=").decode("ascii")
        self.assertEqual(code_challenge_s256(verifier), expected)
        self.assertNotIn("=", code_challenge_s256(verifier))

    def test_extract_account_id_from_id_token(self) -> None:
        token = {"id_token": _fake_id_token("acc-from-jwt")}
        self.assertEqual(_extract_account_id(token), "acc-from-jwt")

    def test_extract_account_id_prefers_direct_field(self) -> None:
        token = {"account_id": "acc-direct", "id_token": _fake_id_token("acc-jwt")}
        self.assertEqual(_extract_account_id(token), "acc-direct")

    def test_profile_encode_decode_roundtrip_is_encrypted(self) -> None:
        profile = {"access": "a", "refresh": "r", "expires": 123, "account_id": "acc"}
        token = encode_oauth_profile(profile)
        self.assertNotIn("access", token)  # ciphertext, no aparece el claro
        self.assertEqual(decode_oauth_profile(token), profile)

    def test_ensure_fresh_keeps_valid_token_without_http(self) -> None:
        profile = {
            "access": "still-valid",
            "refresh": "r",
            "expires": oauth_mod._now_epoch() + 3600,
            "account_id": "acc",
        }
        with mock.patch.object(oauth_mod, "_post_token", side_effect=AssertionError("no HTTP")):
            result, refreshed = ensure_fresh_access_token(profile)
        self.assertFalse(refreshed)
        self.assertEqual(result["access"], "still-valid")

    def test_ensure_fresh_refreshes_expired_token(self) -> None:
        profile = {
            "access": "old-access",
            "refresh": "old-refresh",
            "expires": oauth_mod._now_epoch() - 10,
            "account_id": "acc",
        }
        fake = {"access_token": "new-access", "refresh_token": "new-refresh", "expires_in": 3600}
        with mock.patch.object(oauth_mod, "_post_token", return_value=fake) as posted:
            result, refreshed = ensure_fresh_access_token(profile)
        self.assertTrue(refreshed)
        self.assertTrue(posted.called)
        self.assertEqual(result["access"], "new-access")
        self.assertEqual(result["refresh"], "new-refresh")
        self.assertEqual(result["account_id"], "acc")
        self.assertGreater(result["expires"], oauth_mod._now_epoch())


class OAuthRoutesTest(unittest.TestCase):
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
        self.user_id = uuid.uuid4()
        app.dependency_overrides[get_current_user] = lambda: _session_user(self.user_id)
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def _stored(self) -> AiProviderCredential | None:
        with Session(self.engine) as session:
            from sqlmodel import select

            return session.exec(
                select(AiProviderCredential).where(
                    AiProviderCredential.user_id == self.user_id,
                    AiProviderCredential.credential_type == AiCredentialType.OAUTH,
                    AiProviderCredential.deleted_at.is_(None),
                )
            ).first()

    def _start(self) -> str:
        response = self.client.post(f"{BASE}/start")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["state"]

    def _token_response(self, *, access: str, refresh: str, account_id: str = "acc-123") -> dict[str, object]:
        return {
            "access_token": access,
            "refresh_token": refresh,
            "expires_in": 3600,
            "account_id": account_id,
        }

    def test_start_returns_authorize_url_with_pkce_params(self) -> None:
        response = self.client.post(f"{BASE}/start")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        url = body["authorize_url"]
        self.assertIn("client_id=client-test-id", url)
        self.assertIn("code_challenge=", url)
        self.assertIn("code_challenge_method=S256", url)
        self.assertIn(f"state={body['state']}", url)
        self.assertIn("response_type=code", url)
        self.assertIn("redirect_uri=", url)

    def test_start_503_when_not_configured(self) -> None:
        previous = settings.openai_oauth_client_id
        settings.openai_oauth_client_id = None
        try:
            response = self.client.post(f"{BASE}/start")
            self.assertEqual(response.status_code, 503, response.text)
            self.assertEqual(response.json()["code"], "oauth_not_configured")
        finally:
            settings.openai_oauth_client_id = previous

    def test_complete_stores_encrypted_profile_and_hides_tokens(self) -> None:
        state = self._start()
        token = self._token_response(access="access-secret-aaa", refresh="refresh-secret-bbb")
        with mock.patch.object(oauth_mod, "_post_token", return_value=token):
            response = self.client.post(
                f"{BASE}/complete", json={"code": "auth-code-xyz", "state": state}
            )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertTrue(body["connected"])
        self.assertEqual(body["account_id"], "acc-123")
        self.assertIsNotNone(body["expires_at"])
        # Ningún token aparece en la respuesta.
        self.assertNotIn("access-secret-aaa", response.text)
        self.assertNotIn("refresh-secret-bbb", response.text)

        stored = self._stored()
        assert stored is not None
        self.assertEqual(stored.credential_type, AiCredentialType.OAUTH)
        self.assertEqual(stored.provider, AiProvider.OPENAI)
        # El secreto persistido es ciphertext; el claro no aparece en reposo.
        self.assertNotIn("access-secret-aaa", stored.secret_encrypted)
        profile = decode_oauth_profile(stored.secret_encrypted)
        self.assertEqual(profile["access"], "access-secret-aaa")
        self.assertEqual(profile["refresh"], "refresh-secret-bbb")

    def test_complete_invalid_state_returns_400(self) -> None:
        with mock.patch.object(oauth_mod, "_post_token", side_effect=AssertionError("no HTTP")):
            response = self.client.post(
                f"{BASE}/complete", json={"code": "c", "state": "estado-inexistente"}
            )
        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(response.json()["code"], "invalid_oauth_state")

    def test_complete_reconnect_updates_same_credential(self) -> None:
        state1 = self._start()
        with mock.patch.object(
            oauth_mod, "_post_token", return_value=self._token_response(access="a1", refresh="r1")
        ):
            self.client.post(f"{BASE}/complete", json={"code": "c1", "state": state1})
        state2 = self._start()
        with mock.patch.object(
            oauth_mod, "_post_token", return_value=self._token_response(access="a2", refresh="r2")
        ):
            self.client.post(f"{BASE}/complete", json={"code": "c2", "state": state2})

        with Session(self.engine) as session:
            from sqlmodel import select

            rows = session.exec(
                select(AiProviderCredential).where(
                    AiProviderCredential.credential_type == AiCredentialType.OAUTH,
                    AiProviderCredential.deleted_at.is_(None),
                )
            ).all()
        self.assertEqual(len(rows), 1)
        self.assertEqual(decode_oauth_profile(rows[0].secret_encrypted)["access"], "a2")

    def test_status_reflects_connection(self) -> None:
        before = self.client.get(f"{BASE}/status").json()
        self.assertFalse(before["connected"])

        state = self._start()
        with mock.patch.object(
            oauth_mod, "_post_token", return_value=self._token_response(access="a", refresh="r")
        ):
            self.client.post(f"{BASE}/complete", json={"code": "c", "state": state})

        after = self.client.get(f"{BASE}/status").json()
        self.assertTrue(after["connected"])
        self.assertEqual(after["account_id"], "acc-123")
        self.assertIsNotNone(after["expires_at"])

    def test_delete_soft_deletes_connection(self) -> None:
        state = self._start()
        with mock.patch.object(
            oauth_mod, "_post_token", return_value=self._token_response(access="a", refresh="r")
        ):
            self.client.post(f"{BASE}/complete", json={"code": "c", "state": state})

        deleted = self.client.delete(BASE)
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertFalse(self.client.get(f"{BASE}/status").json()["connected"])
        # Segunda baja ya no encuentra conexión.
        self.assertEqual(self.client.delete(BASE).status_code, 404)


class OAuthLeaseTest(unittest.TestCase):
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
        self.user_id = uuid.uuid4()
        # Se fija aquí (no a nivel de módulo) para que el arriendo valide contra el
        # mismo secreto que envía el header, sin importar el orden de la suite.
        settings.agent_gateway_internal_secret = SecretStr(INTERNAL_SECRET)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def _seed_oauth(self, profile: dict[str, object]) -> None:
        with Session(self.engine) as session:
            cred = AiProviderCredential(
                user_id=self.user_id,
                provider=AiProvider.OPENAI,
                credential_type=AiCredentialType.OAUTH,
                label="ChatGPT (OAuth)",
                secret_encrypted=encode_oauth_profile(profile),
                is_active=True,
            )
            session.add(cred)
            session.commit()

    def _lease(self):
        payload = {"user_id": str(self.user_id), "provider": "openai"}
        return self.client.post(LEASE_URL, json=payload, headers={"X-Internal-Auth": INTERNAL_SECRET})

    def test_lease_returns_access_token_without_refresh_when_valid(self) -> None:
        # Token vigente pero corto: el arriendo queda acotado por el vencimiento del token.
        profile = {
            "access": "valid-access-token",
            "refresh": "some-refresh",
            "expires": oauth_mod._now_epoch() + 100,
            "account_id": "acc-1",
        }
        self._seed_oauth(profile)
        with mock.patch.object(oauth_mod, "_post_token", side_effect=AssertionError("no debe refrescar")):
            response = self._lease()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["secret"], "valid-access-token")

    def test_lease_refreshes_expired_token_and_persists(self) -> None:
        profile = {
            "access": "expired-access",
            "refresh": "refresh-old",
            "expires": oauth_mod._now_epoch() - 5,
            "account_id": "acc-1",
        }
        self._seed_oauth(profile)
        fake = {"access_token": "fresh-access", "refresh_token": "refresh-new", "expires_in": 3600}
        with mock.patch.object(oauth_mod, "_post_token", return_value=fake) as posted:
            response = self._lease()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["secret"], "fresh-access")
        self.assertTrue(posted.called)

        # El perfil refrescado se reguardó cifrado.
        with Session(self.engine) as session:
            from sqlmodel import select

            cred = session.exec(
                select(AiProviderCredential).where(
                    AiProviderCredential.user_id == self.user_id
                )
            ).first()
        assert cred is not None
        self.assertEqual(decode_oauth_profile(cred.secret_encrypted)["access"], "fresh-access")

    def test_lease_502_when_refresh_fails(self) -> None:
        profile = {
            "access": "expired-access",
            "refresh": "refresh-old",
            "expires": oauth_mod._now_epoch() - 5,
            "account_id": "acc-1",
        }
        self._seed_oauth(profile)
        with mock.patch.object(
            oauth_mod,
            "_post_token",
            side_effect=oauth_mod.OAuthError("oauth_token_rejected", "rechazado"),
        ):
            response = self._lease()
        self.assertEqual(response.status_code, 502, response.text)
        self.assertEqual(response.json()["code"], "oauth_token_rejected")

    def test_oauth_tokens_are_not_written_to_logs(self) -> None:
        profile = {
            "access": "log-leak-access-9999",
            "refresh": "log-leak-refresh-8888",
            "expires": oauth_mod._now_epoch() - 5,
            "account_id": "acc-1",
        }
        self._seed_oauth(profile)
        fake = {
            "access_token": "log-leak-fresh-7777",
            "refresh_token": "log-leak-refresh-new-6666",
            "expires_in": 3600,
        }

        records: list[str] = []

        class _Capture(logging.Handler):
            def emit(self, record: logging.LogRecord) -> None:
                records.append(self.format(record))

        handler = _Capture()
        handler.setFormatter(logging.Formatter("%(message)s"))
        root = logging.getLogger()
        previous_level = root.level
        root.setLevel(logging.DEBUG)
        root.addHandler(handler)
        try:
            with mock.patch.object(oauth_mod, "_post_token", return_value=fake):
                response = self._lease()
        finally:
            root.removeHandler(handler)
            root.setLevel(previous_level)

        self.assertEqual(response.status_code, 200, response.text)
        joined = "\n".join(records)
        for secret in (
            "log-leak-access-9999",
            "log-leak-refresh-8888",
            "log-leak-fresh-7777",
            "log-leak-refresh-new-6666",
            INTERNAL_SECRET,
        ):
            self.assertNotIn(secret, joined)


if __name__ == "__main__":
    unittest.main()
