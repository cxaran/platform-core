import os
import unittest
import uuid
from datetime import datetime, timezone

import jwt
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
    "AGENT_GATEWAY_TICKET_SIGNING_SECRET": "test-agent-ticket-secret",
}

os.environ.update(DEV_ENV)

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlmodel import Session  # noqa: E402

from backend.app.agent.ticket import (  # noqa: E402
    TICKET_AUDIENCE,
    issue_connection_ticket,
    verify_connection_ticket,
)
from backend.app.auth.auth_dependencies import get_current_user_orm  # noqa: E402
from backend.app.core.database import get_db  # noqa: E402
from backend.app.core.settings import settings  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.app.models import Base  # noqa: E402
from backend.app.models.user import User  # noqa: E402


client = TestClient(app)


def _fake_user(token: str = "session-version-1") -> User:
    return User(
        id=uuid.uuid4(),
        name="Usuaria",
        last_name="QA",
        email="usuaria@example.com",
        hashed_password="x",
        is_active=True,
        token=token,
    )


def _signing_secret() -> str:
    return settings.agent_gateway_ticket_signing_secret.get_secret_value()


class IssueConnectionTicketTest(unittest.TestCase):
    def test_issue_returns_jwt_verifiable_with_secret(self) -> None:
        user = _fake_user()
        ticket, expires_at = issue_connection_ticket(user)

        # El ticket se verifica con el secreto del ticket (no con datos de sesión).
        claims = verify_connection_ticket(ticket)
        self.assertEqual(claims["sub"], str(user.id))
        self.assertEqual(claims["sid"], "session-version-1")
        self.assertEqual(claims["aud"], TICKET_AUDIENCE)
        self.assertGreater(expires_at, datetime.now(timezone.utc))

    def test_claims_carry_no_business_data_or_permissions(self) -> None:
        ticket, _ = issue_connection_ticket(_fake_user())
        claims = verify_connection_ticket(ticket)
        self.assertEqual(set(claims.keys()), {"sub", "sid", "aud", "iat", "exp"})

    def test_ticket_ttl_is_short(self) -> None:
        ticket, _ = issue_connection_ticket(_fake_user())
        claims = verify_connection_ticket(ticket)
        ttl = claims["exp"] - claims["iat"]
        self.assertEqual(ttl, settings.agent_gateway_ticket_ttl_seconds)
        self.assertGreaterEqual(ttl, 60)
        self.assertLessEqual(ttl, 300)


class VerifyConnectionTicketTest(unittest.TestCase):
    def test_rejects_invalid_signature(self) -> None:
        ticket, _ = issue_connection_ticket(_fake_user())
        # Firmado con otro secreto -> firma inválida.
        tampered = jwt.encode(
            jwt.decode(ticket, options={"verify_signature": False}),
            "otro-secreto",
            algorithm="HS256",
        )
        with self.assertRaises(jwt.InvalidSignatureError):
            verify_connection_ticket(tampered)

    def test_rejects_wrong_audience(self) -> None:
        now = datetime.now(timezone.utc)
        token = jwt.encode(
            {
                "sub": str(uuid.uuid4()),
                "sid": "s",
                "aud": "otra-audiencia",
                "iat": int(now.timestamp()),
                "exp": int(now.timestamp()) + 90,
            },
            _signing_secret(),
            algorithm="HS256",
        )
        with self.assertRaises(jwt.InvalidAudienceError):
            verify_connection_ticket(token)

    def test_rejects_expired(self) -> None:
        now = datetime.now(timezone.utc)
        token = jwt.encode(
            {
                "sub": str(uuid.uuid4()),
                "sid": "s",
                "aud": TICKET_AUDIENCE,
                "iat": int(now.timestamp()) - 200,
                "exp": int(now.timestamp()) - 100,
            },
            _signing_secret(),
            algorithm="HS256",
        )
        with self.assertRaises(jwt.ExpiredSignatureError):
            verify_connection_ticket(token)


class ConnectionTicketEndpointTest(unittest.TestCase):
    def setUp(self) -> None:
        # El endpoint resuelve el TTL efectivo desde system_settings: BD en memoria.
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

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_requires_session(self) -> None:
        response = client.post("/api/v1/agent/connection-ticket")
        self.assertEqual(response.status_code, 401)

    def test_returns_ticket_with_valid_session(self) -> None:
        user = _fake_user(token="session-version-7")
        app.dependency_overrides[get_current_user_orm] = lambda: user

        response = client.post("/api/v1/agent/connection-ticket")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("ticket", body)
        self.assertIn("expires_at", body)

        claims = verify_connection_ticket(body["ticket"])
        self.assertEqual(claims["sub"], str(user.id))
        self.assertEqual(claims["sid"], "session-version-7")
        self.assertEqual(claims["aud"], TICKET_AUDIENCE)

    def test_openapi_exposes_connection_ticket(self) -> None:
        response = client.get("/api/openapi.json")
        self.assertEqual(response.status_code, 200)
        self.assertIn("/api/v1/agent/connection-ticket", response.json()["paths"])


if __name__ == "__main__":
    unittest.main()
