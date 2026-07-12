"""Notificaciones persistentes: primitivas genéricas, cola de correo y campana.

Base des-domainizada: notificaciones dirigidas (``notify_user`` /
``notify_users_with_permission``), difusión del administrador (``broadcast``),
cola de correo (``dispatch_pending_emails``: sent/failed/skipped) y la campana
propia (/me, read, read-all) como recurso PROPIO.
"""

import asyncio
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
from backend.app.models.user import Role, RoleAccess, User, UserRole  # noqa: E402
from backend.app.services.email_service import EmailOutcome  # noqa: E402
from backend.app.services.notification_service import (  # noqa: E402
    broadcast,
    create_notification,
    dispatch_pending_emails,
    notification_href,
    notify_users_with_permission,
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


def _grant(session: Session, user: User, permission: str) -> None:
    role = Role(name=f"rol-{uuid.uuid4().hex[:6]}", description="t")
    session.add(role)
    session.flush()
    session.add(RoleAccess(role_id=role.id, access=permission, is_active=True))
    session.add(UserRole(user_id=user.id, role_id=role.id))
    session.flush()


class NotificationServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = _engine()

    def test_notify_users_with_permission_targets_only_grantees(self) -> None:
        with Session(self.engine) as session:
            with_perm = _make_user(session, "con@example.com")
            other_perm = _make_user(session, "otro@example.com")
            _make_user(session, "sin@example.com")  # sin rol: no recibe
            _grant(session, with_perm, "backups:read")
            _grant(session, other_perm, "users:read")

            created = notify_users_with_permission(
                session,
                permission="backups:read",
                title="Aviso",
                body="Algo pasó",
            )
            session.commit()

            self.assertEqual(created, 1)
            rows = session.exec(select(Notification)).all()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0].user_id, with_perm.id)
            self.assertEqual(rows[0].kind, "system")

    def test_broadcast_audiences(self) -> None:
        with Session(self.engine) as session:
            customer = _make_user(session, "cliente@example.com")
            staff = _make_user(session, "staff@example.com")
            _grant(session, staff, "users:read")
            session.commit()

            self.assertEqual(broadcast(session, title="A", body="b", audience="all"), 2)
            self.assertEqual(
                broadcast(session, title="A", body="b", audience="customers"), 1
            )
            self.assertEqual(
                broadcast(session, title="A", body="b", audience="staff"), 1
            )
            session.commit()

            customer_rows = session.exec(
                select(Notification).where(Notification.user_id == customer.id)
            ).all()
            # all + customers = 2 filas para el cliente sin rol.
            self.assertEqual(len(customer_rows), 2)
            self.assertTrue(all(row.kind == "promo" for row in customer_rows))

    def test_dispatch_marks_sent_failed_and_skipped(self) -> None:
        with Session(self.engine) as session:
            ok_user = _make_user(session, "ok@example.com")
            bad_user = _make_user(session, "bad@example.com")
            gone_user = _make_user(session, "gone@example.com")
            broadcast(session, title="Promo", body="Novedad", audience="all")
            # El usuario se desactiva DESPUÉS de encolarse su correo: el
            # despacho lo salta (skipped) en vez de escribirle.
            gone_user.is_active = False
            session.add(gone_user)
            session.commit()

            async def fake_send(_session, *, subject, email_to, message):  # noqa: ANN001
                if email_to == "bad@example.com":
                    return EmailOutcome(sent=False, error_code="send_failed", error_summary="boom")
                return EmailOutcome(sent=True)

            with patch(
                "backend.app.services.email_service.send_system_email", new=fake_send
            ):
                sent = asyncio.run(dispatch_pending_emails(session))
            session.commit()

            self.assertEqual(sent, 1)  # solo ok_user (bad falla, gone inactivo)
            by_user = {
                row.user_id: row for row in session.exec(select(Notification)).all()
            }
            self.assertEqual(by_user[ok_user.id].email_status, "sent")
            self.assertEqual(by_user[bad_user.id].email_status, "failed")
            self.assertEqual(by_user[bad_user.id].email_error, "boom")
            self.assertEqual(by_user[gone_user.id].email_status, "skipped")


class NotificationRoutesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = _engine()

        def override_db():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)

        with Session(self.engine) as session:
            self.user_id = _make_user(session, "yo@example.com").id
            other = _make_user(session, "otro@example.com")
            session.add_all(
                [
                    Notification(
                        user_id=self.user_id, kind="promo", title="Hola", body="Promo",
                    ),
                    Notification(
                        user_id=self.user_id, kind="promo", title="Dos", body="Promo",
                    ),
                    Notification(
                        user_id=other.id, kind="promo", title="Ajena", body="Promo",
                    ),
                ]
            )
            session.commit()

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def _as(self, *permissions: str) -> None:
        from backend.app.auth.auth_dependencies import get_current_user
        from backend.app.schemas.user import SessionUser

        app.dependency_overrides[get_current_user] = lambda: SessionUser(
            id=self.user_id, name="Yo", last_name="Mismo", email="yo@example.com",
            permissions=set(permissions),
        )

    def test_me_lists_only_own_and_counts_unread(self) -> None:
        self._as()
        body = self.client.get("/api/v1/notifications/me").json()
        self.assertEqual(body["unread_count"], 2)
        self.assertEqual(len(body["items"]), 2)
        self.assertTrue(all(item["title"] != "Ajena" for item in body["items"]))

        marked = self.client.post("/api/v1/notifications/me/read-all").json()
        self.assertEqual(marked["marked"], 2)
        self.assertEqual(
            self.client.get("/api/v1/notifications/me").json()["unread_count"], 0
        )

    def test_read_single_is_own_only(self) -> None:
        self._as()
        mine = self.client.get("/api/v1/notifications/me").json()["items"][0]
        done = self.client.post(f"/api/v1/notifications/{mine['id']}/read")
        self.assertEqual(done.status_code, 200, done.text)
        self.assertIsNotNone(done.json()["read_at"])

        with Session(self.engine) as session:
            ajena = session.exec(
                select(Notification).where(Notification.title == "Ajena")
            ).one()
        # 404 uniforme: la notificación de otro usuario "no existe".
        self.assertEqual(
            self.client.post(f"/api/v1/notifications/{ajena.id}/read").status_code, 404
        )

    def test_broadcast_requires_permission_and_targets_audience(self) -> None:
        self._as()
        denied = self.client.post(
            "/api/v1/notifications/broadcast",
            json={"title": "Promo", "body": "Novedad"},
        )
        self.assertEqual(denied.status_code, 403)

        self._as("notifications:send")
        sent = self.client.post(
            "/api/v1/notifications/broadcast",
            json={"title": "Promo", "body": "Novedad", "audience": "customers"},
        )
        self.assertEqual(sent.status_code, 201, sent.text)
        # yo + otro son clientes sin rol: 2 destinatarios.
        self.assertEqual(sent.json()["created"], 2)

    def test_broadcast_rejects_unsafe_link(self) -> None:
        self._as("notifications:send")
        bad = self.client.post(
            "/api/v1/notifications/broadcast",
            json={"title": "P", "body": "b", "link_url": "javascript:alert(1)"},
        )
        self.assertEqual(bad.status_code, 422, bad.text)

    def test_unread_only_and_href_from_link_url(self) -> None:
        with Session(self.engine) as session:
            create_notification(
                session, user_id=self.user_id, kind="promo", title="Con enlace",
                body="b", link_url="/algun-destino",
            )
            session.commit()

        self._as()
        # unread_only=true: solo las no leídas (las 2 de setUp + esta nueva = 3).
        body = self.client.get(
            "/api/v1/notifications/me?unread_only=true"
        ).json()
        self.assertEqual(len(body["items"]), 3)
        con_enlace = next(i for i in body["items"] if i["title"] == "Con enlace")
        self.assertEqual(con_enlace["href"], "/algun-destino")
        # Las promos sin link_url no tienen destino.
        sin_enlace = next(i for i in body["items"] if i["title"] == "Hola")
        self.assertIsNone(sin_enlace["href"])


class NotificationHrefTest(unittest.TestCase):
    def test_href_is_link_url_or_none(self) -> None:
        self.assertEqual(notification_href("promo", "/x"), "/x")
        self.assertIsNone(notification_href("promo", None))
        self.assertIsNone(notification_href("system", ""))


if __name__ == "__main__":
    unittest.main()
