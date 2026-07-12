"""Mantenimiento operativo: poda por retención y alertas activas de respaldos.

Cubre:
- Retención NULL = sin poda (comportamiento histórico intacto).
- Poda de auditoría por antigüedad; poda de notificaciones SOLO leídas (las no
  leídas nunca se podan, por viejas que sean).
- Un respaldo fallido definitivo crea una alerta (campana/correo/push) para los
  usuarios con permiso de configurar respaldos — no solo `last_error` en el panel.
"""

import os
import unittest
import uuid
from datetime import time, timedelta


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

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from backend.app.models import Base  # noqa: E402
from backend.app.models.audit_event import AuditEvent  # noqa: E402
from backend.app.models.backup import BackupRun, BackupSettings  # noqa: E402
from backend.app.models.enums import BackupRunStatus, BackupTriggerKind  # noqa: E402
from backend.app.models.notification import Notification  # noqa: E402
from backend.app.models.system_settings import SystemSettings  # noqa: E402
from backend.app.models.user import RoleAccess, Role, User, UserRole  # noqa: E402
from backend.app.services.backup_service import BackupService  # noqa: E402
from backend.app.services.maintenance_service import run_retention  # noqa: E402
from backend.app.utils.utc_now import utc_now  # noqa: E402


def _make_session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return Session(engine)


def _audit(days_old: int) -> AuditEvent:
    return AuditEvent(
        entity_type="x",
        entity_id=uuid.uuid4(),
        action="probe",
        occurred_at=utc_now() - timedelta(days=days_old),
    )


def _notification(user_id: uuid.UUID, days_old: int, *, read: bool) -> Notification:
    return Notification(
        user_id=user_id,
        kind="system",
        title="t",
        body="b",
        email_status="skipped",
        push_status="skipped",
        created_at=utc_now() - timedelta(days=days_old),
        read_at=utc_now() - timedelta(days=days_old) if read else None,
    )


class RetentionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.session = _make_session()
        self.user = User(
            id=uuid.uuid4(), name="Admin", last_name="Ops", email="ops@example.com",
            hashed_password="x", is_active=True,
        )
        self.session.add(self.user)
        self.session.add(SystemSettings())
        self.session.flush()

    def tearDown(self) -> None:
        self.session.close()

    def _counts(self) -> tuple[int, int]:
        audits = len(self.session.exec(select(AuditEvent)).all())
        notes = len(self.session.exec(select(Notification)).all())
        return audits, notes

    def test_null_retention_prunes_nothing(self) -> None:
        self.session.add(_audit(days_old=4000))
        self.session.add(_notification(self.user.id, 4000, read=True))
        self.session.flush()

        result = run_retention(self.session)

        self.assertEqual(result.audit_deleted, 0)
        self.assertEqual(result.notifications_deleted, 0)
        self.assertEqual(self._counts(), (1, 1))

    def test_audit_retention_prunes_only_older(self) -> None:
        config = self.session.exec(select(SystemSettings)).first()
        assert config is not None
        config.audit_retention_days = 30
        self.session.add(config)
        self.session.add(_audit(days_old=45))
        self.session.add(_audit(days_old=5))
        self.session.flush()

        result = run_retention(self.session)

        self.assertEqual(result.audit_deleted, 1)
        remaining = self.session.exec(select(AuditEvent)).all()
        self.assertEqual(len(remaining), 1)

    def test_notification_retention_never_prunes_unread(self) -> None:
        config = self.session.exec(select(SystemSettings)).first()
        assert config is not None
        config.notification_retention_days = 30
        self.session.add(config)
        self.session.add(_notification(self.user.id, 90, read=True))   # se poda
        self.session.add(_notification(self.user.id, 90, read=False))  # NUNCA se poda
        self.session.add(_notification(self.user.id, 5, read=True))    # reciente: queda
        self.session.flush()

        result = run_retention(self.session)

        self.assertEqual(result.notifications_deleted, 1)
        remaining = self.session.exec(select(Notification)).all()
        self.assertEqual(len(remaining), 2)
        self.assertTrue(any(row.read_at is None for row in remaining))


class BackupFailureAlertTest(unittest.TestCase):
    def setUp(self) -> None:
        self.session = _make_session()
        # Admin de respaldos: usuario activo con rol activo que otorga backups:configure.
        self.admin = User(
            id=uuid.uuid4(), name="Admin", last_name="Ops", email="ops@example.com",
            hashed_password="x", is_active=True,
        )
        role = Role(id=uuid.uuid4(), name="Ops", is_active=True)
        self.session.add_all([
            self.admin,
            role,
            UserRole(user_id=self.admin.id, role_id=role.id),
            RoleAccess(role_id=role.id, access="backups:configure", is_active=True),
            BackupSettings(
                enabled=False, timezone="UTC", daily_time=time(3, 0),
                filename_prefix="respaldo", retention_daily_count=7,
                retention_monthly_count=12, retention_yearly_count=5,
            ),
        ])
        self.session.flush()

    def tearDown(self) -> None:
        self.session.close()

    def test_finish_failed_alerts_backup_admins(self) -> None:
        run = BackupRun(trigger_kind=BackupTriggerKind.MANUAL, status=BackupRunStatus.RUNNING)
        self.session.add(run)
        self.session.flush()

        service = BackupService(worker_id="test-worker")
        service._finish_failed(  # noqa: SLF001 — es exactamente lo que se prueba
            self.session, run, code="drive_upload_failed", summary="Se agotó el reintento."
        )

        alerts = self.session.exec(
            select(Notification).where(Notification.user_id == self.admin.id)
        ).all()
        self.assertEqual(len(alerts), 1)
        self.assertIn("Respaldo fallido", alerts[0].title)
        self.assertIn("drive_upload_failed", alerts[0].body)
        self.assertEqual(alerts[0].link_url, "/backups")
        self.assertTrue(service._alerts_pending)  # noqa: SLF001
        # La fila queda pending para el despacho de correo del tick.
        self.assertEqual(alerts[0].email_status, "pending")


if __name__ == "__main__":
    unittest.main()
