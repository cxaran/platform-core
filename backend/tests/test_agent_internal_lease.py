import logging
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
    "AGENT_GATEWAY_TICKET_SIGNING_SECRET": "test-agent-ticket-secret",
}

os.environ.update(DEV_ENV)

from cryptography.fernet import Fernet  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from pydantic import SecretStr  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlmodel import Session  # noqa: E402

from backend.app.core.settings import settings  # noqa: E402

INTERNAL_SECRET = "internal-shared-secret-xyz"
settings.app_encryption_key = SecretStr(Fernet.generate_key().decode())
settings.agent_gateway_internal_secret = SecretStr(INTERNAL_SECRET)
# Evita la dependencia de Redis del rate-limit en el test del endpoint.
settings.rate_limit_enabled = False

from backend.app.agent.crypto import encrypt_secret  # noqa: E402
from backend.app.core.database import get_db  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.app.models import Base  # noqa: E402
from backend.app.models.ai_provider_credential import AiProviderCredential  # noqa: E402
from backend.app.models.audit_event import AuditEvent  # noqa: E402
from backend.app.models.enums import AiProvider  # noqa: E402


LEASE_URL = "/api/v1/internal/agent/credential-lease"
PLAINTEXT = "sk-real-provider-key-9999"


class CredentialLeaseEndpointTest(unittest.TestCase):
    def setUp(self) -> None:
        # Se fija POR TEST (otra suite del mismo proceso puede haberlo reasignado).
        settings.agent_gateway_internal_secret = SecretStr(INTERNAL_SECRET)
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

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def _seed(
        self,
        *,
        provider: AiProvider = AiProvider.OPENAI,
        is_active: bool = True,
        deleted: bool = False,
        secret: str = PLAINTEXT,
        default_model: str | None = "gpt-4o",
    ) -> uuid.UUID:
        with Session(self.engine) as session:
            cred = AiProviderCredential(
                user_id=self.user_id,
                provider=provider,
                label="Mi credencial",
                secret_encrypted=encrypt_secret(secret),
                is_active=is_active,
                default_model=default_model,
            )
            if deleted:
                from backend.app.utils.utc_now import utc_now

                cred.deleted_at = utc_now()
            session.add(cred)
            session.commit()
            session.refresh(cred)
            return cred.id

    def _post(self, headers: dict[str, str] | None = None, **body: object):
        payload: dict[str, object] = {"user_id": str(self.user_id), "provider": "openai"}
        payload.update(body)
        return self.client.post(LEASE_URL, json=payload, headers=headers or {})

    def test_valid_header_returns_decrypted_secret(self) -> None:
        self._seed()
        response = self._post(headers={"X-Internal-Auth": INTERNAL_SECRET})
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["secret"], PLAINTEXT)
        self.assertEqual(body["default_model"], "gpt-4o")
        self.assertIn("lease_id", body)
        self.assertIn("expires_at", body)

    def test_missing_header_is_unauthorized(self) -> None:
        self._seed()
        response = self._post()
        self.assertEqual(response.status_code, 401, response.text)
        self.assertNotIn(PLAINTEXT, response.text)

    def test_wrong_header_is_unauthorized(self) -> None:
        self._seed()
        response = self._post(headers={"X-Internal-Auth": "wrong-secret"})
        self.assertEqual(response.status_code, 401, response.text)

    def test_no_active_credential_returns_404(self) -> None:
        # Existe pero inactiva -> no se arrienda.
        self._seed(is_active=False)
        response = self._post(headers={"X-Internal-Auth": INTERNAL_SECRET})
        self.assertEqual(response.status_code, 404, response.text)

    def test_deleted_credential_returns_404(self) -> None:
        self._seed(deleted=True)
        response = self._post(headers={"X-Internal-Auth": INTERNAL_SECRET})
        self.assertEqual(response.status_code, 404, response.text)

    def test_other_provider_returns_404(self) -> None:
        self._seed(provider=AiProvider.ANTHROPIC)
        response = self._post(headers={"X-Internal-Auth": INTERNAL_SECRET}, provider="openai")
        self.assertEqual(response.status_code, 404, response.text)

    def test_lease_writes_audit_event_without_secret(self) -> None:
        # El arriendo queda auditado (acción + lease_id + provider), NUNCA con el secreto.
        self._seed()
        response = self._post(headers={"X-Internal-Auth": INTERNAL_SECRET})
        self.assertEqual(response.status_code, 200, response.text)
        with Session(self.engine) as session:
            events = session.query(AuditEvent).all()
        self.assertEqual(len(events), 1)
        event = events[0]
        self.assertEqual(event.action, "ai_credential_leased")
        self.assertEqual(event.entity_type, "ai_provider_credentials")
        serialized = str(event.changed_fields)
        self.assertNotIn(PLAINTEXT, serialized)
        self.assertIn("provider", serialized)

    def test_secret_is_not_written_to_logs(self) -> None:
        self._seed(secret="sk-must-not-be-logged-7777")
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
            response = self._post(
                headers={"X-Internal-Auth": INTERNAL_SECRET}, provider="openai"
            )
        finally:
            root.removeHandler(handler)
            root.setLevel(previous_level)

        self.assertEqual(response.status_code, 200, response.text)
        joined = "\n".join(records)
        self.assertNotIn("sk-must-not-be-logged-7777", joined)
        self.assertNotIn(INTERNAL_SECRET, joined)


if __name__ == "__main__":
    unittest.main()
