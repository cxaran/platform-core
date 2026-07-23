"""Web Push: credenciales VAPID, suscripciones por dispositivo y cola push."""

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

from unittest.mock import patch  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from backend.app.core.database import get_db  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.app.models import Base  # noqa: E402
from backend.app.models.notification import Notification  # noqa: E402
from backend.app.models.push import PushSubscription, WebPushCredential  # noqa: E402
from backend.app.models.user import User  # noqa: E402
from backend.app.services.notification_service import create_notification  # noqa: E402
from backend.app.services import secret_cipher  # noqa: E402
from backend.app.services.push_service import (  # noqa: E402
    dispatch_pending_pushes,
    get_vapid_credentials,
    save_subscription,
)

from pydantic import SecretStr  # noqa: E402

# Fernet real (el entorno de la suite no trae APP_ENCRYPTION_KEY y settings ya
# está cacheado cuando este módulo carga): se parchea el OBJETO settings, mismo
# patrón que test_secret_cipher.
_FERNET_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="


def _with_encryption_key():
    return patch.multiple(
        secret_cipher.settings, app_encryption_key=SecretStr(_FERNET_KEY)
    )


def _engine():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    return engine


def _make_user(session: Session, email: str, *, active: bool = True) -> User:
    user = User(
        name="U", last_name="Ser", email=email, hashed_password="x", is_active=active
    )
    session.add(user)
    session.flush()
    return user


def _subscribe(session: Session, user: User, endpoint: str) -> PushSubscription:
    return save_subscription(
        session, user_id=user.id, endpoint=endpoint, p256dh="pk", auth="ak"
    )


class VapidCredentialsTest(unittest.TestCase):
    def test_generate_once_and_reuse(self) -> None:
        engine = _engine()
        with _with_encryption_key(), Session(engine) as session:
            public1, pem1 = get_vapid_credentials(session)
            session.commit()
            public2, pem2 = get_vapid_credentials(session)
            self.assertEqual(public1, public2)
            self.assertEqual(pem1, pem2)
            self.assertTrue(pem1.startswith("-----BEGIN"))
            rows = session.exec(select(WebPushCredential)).all()
            self.assertEqual(len(rows), 1)
            # La privada JAMÁS se guarda en claro.
            self.assertNotIn("BEGIN", rows[0].private_key_encrypted)


class SubscriptionServiceTest(unittest.TestCase):
    def test_upsert_by_endpoint_and_owner_change(self) -> None:
        engine = _engine()
        with Session(engine) as session:
            ana = _make_user(session, "ana@example.com")
            beto = _make_user(session, "beto@example.com")
            _subscribe(session, ana, "https://push.example/e1")
            # Mismo navegador, ahora con la sesión de Beto: cambia de dueño.
            save_subscription(
                session, user_id=beto.id, endpoint="https://push.example/e1",
                p256dh="pk2", auth="ak2", user_agent="UA",
            )
            session.commit()
            rows = session.exec(select(PushSubscription)).all()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0].user_id, beto.id)
            self.assertEqual(rows[0].p256dh, "pk2")


class PushDispatchTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = _engine()

    def test_dispatch_marks_sent_skipped_failed_and_prunes_dead(self) -> None:
        with Session(self.engine) as session:
            ok_user = _make_user(session, "ok@example.com")
            sin_subs = _make_user(session, "sin@example.com")
            fail_user = _make_user(session, "fail@example.com")
            dead_user = _make_user(session, "dead@example.com")
            _subscribe(session, ok_user, "https://push.example/ok")
            _subscribe(session, fail_user, "https://push.example/fail")
            _subscribe(session, dead_user, "https://push.example/dead")
            for user in (ok_user, sin_subs, fail_user, dead_user):
                create_notification(
                    session, user_id=user.id, kind="promo", title="Hola", body="B"
                )
            session.commit()

            def fake_send(subscription, payload, *, private_pem):  # noqa: ANN001
                if subscription.endpoint.endswith("/fail"):
                    return 500
                if subscription.endpoint.endswith("/dead"):
                    return 410
                return None

            with _with_encryption_key(), patch(
                "backend.app.services.push_service._send_webpush", new=fake_send
            ):
                sent = dispatch_pending_pushes(session)
            session.commit()

            self.assertEqual(sent, 1)
            by_user = {
                row.user_id: row for row in session.exec(select(Notification)).all()
            }
            self.assertEqual(by_user[ok_user.id].push_status, "sent")
            self.assertEqual(by_user[sin_subs.id].push_status, "skipped")
            self.assertEqual(by_user[fail_user.id].push_status, "failed")
            self.assertEqual(by_user[fail_user.id].push_error, "push_http_500")
            # 410 → la suscripción muerta se borra y la fila queda 'skipped'.
            self.assertEqual(by_user[dead_user.id].push_status, "skipped")
            endpoints = [
                row.endpoint for row in session.exec(select(PushSubscription)).all()
            ]
            self.assertNotIn("https://push.example/dead", endpoints)

    def test_multi_device_sent_if_any_delivers(self) -> None:
        with Session(self.engine) as session:
            user = _make_user(session, "dos@example.com")
            _subscribe(session, user, "https://push.example/viejo")
            _subscribe(session, user, "https://push.example/nuevo")
            create_notification(
                session, user_id=user.id, kind="promo", title="Hola", body="B"
            )
            session.commit()

            def fake_send(subscription, payload, *, private_pem):  # noqa: ANN001
                return 410 if subscription.endpoint.endswith("/viejo") else None

            with _with_encryption_key(), patch(
                "backend.app.services.push_service._send_webpush", new=fake_send
            ):
                sent = dispatch_pending_pushes(session)
            session.commit()

            self.assertEqual(sent, 1)
            row = session.exec(select(Notification)).one()
            self.assertEqual(row.push_status, "sent")
            remaining = session.exec(select(PushSubscription)).all()
            self.assertEqual(len(remaining), 1)

    def test_inactive_user_is_skipped(self) -> None:
        with Session(self.engine) as session:
            user = _make_user(session, "fuera@example.com")
            _subscribe(session, user, "https://push.example/x")
            create_notification(
                session, user_id=user.id, kind="promo", title="Hola", body="B"
            )
            user.is_active = False
            session.add(user)
            session.commit()

            with _with_encryption_key(), patch(
                "backend.app.services.push_service._send_webpush",
                new=lambda *a, **k: None,
            ):
                sent = dispatch_pending_pushes(session)
            session.commit()
            self.assertEqual(sent, 0)
            row = session.exec(select(Notification)).one()
            self.assertEqual(row.push_status, "skipped")


class PushRoutesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = _engine()

        def override_db():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)
        with Session(self.engine) as session:
            self.user_id = _make_user(session, "yo@example.com").id
            self.other_id = _make_user(session, "otro@example.com").id
            session.commit()

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def _as(self, user_id: uuid.UUID) -> None:
        from backend.app.auth.auth_dependencies import get_current_user
        from backend.app.schemas.user import SessionUser

        app.dependency_overrides[get_current_user] = lambda: SessionUser(
            id=user_id, name="Yo", last_name="Mismo", email="yo@example.com",
            permissions=set(),
        )

    def test_public_key_is_stable(self) -> None:
        self._as(self.user_id)
        with _with_encryption_key():
            first = self.client.get("/api/v1/notifications/push/public-key")
            self.assertEqual(first.status_code, 200, first.text)
            second = self.client.get("/api/v1/notifications/push/public-key")
        self.assertEqual(first.json()["public_key"], second.json()["public_key"])
        self.assertGreater(len(first.json()["public_key"]), 80)

    def test_public_key_unavailable_without_encryption_key(self) -> None:
        # Sin clave Fernet no hay credenciales VAPID: 503 con código claro.
        self._as(self.user_id)
        with patch.multiple(
            secret_cipher.settings,
            app_encryption_key=None,
        ):
            response = self.client.get("/api/v1/notifications/push/public-key")
        self.assertEqual(response.status_code, 503, response.text)

    def test_subscribe_and_unsubscribe_own_only(self) -> None:
        self._as(self.user_id)
        saved = self.client.put(
            "/api/v1/notifications/push/subscription",
            json={
                "endpoint": "https://push.example/mio",
                "keys": {"p256dh": "pk", "auth": "ak"},
            },
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertTrue(saved.json()["saved"])

        # Otro usuario no puede dar de baja una suscripción ajena.
        self._as(self.other_id)
        foreign = self.client.post(
            "/api/v1/notifications/push/unsubscribe",
            json={"endpoint": "https://push.example/mio"},
        )
        self.assertEqual(foreign.status_code, 200)
        self.assertFalse(foreign.json()["removed"])

        self._as(self.user_id)
        own = self.client.post(
            "/api/v1/notifications/push/unsubscribe",
            json={"endpoint": "https://push.example/mio"},
        )
        self.assertTrue(own.json()["removed"])
        with Session(self.engine) as session:
            self.assertEqual(session.exec(select(PushSubscription)).all(), [])


if __name__ == "__main__":
    unittest.main()
