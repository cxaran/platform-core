"""Mantenimiento de datos operativos: poda por retención configurada.

Aplica las políticas de ``system_settings`` (editable en runtime; NULL = sin poda,
el comportamiento histórico):

- ``audit_retention_days`` — elimina de ``audit_events`` lo más antiguo que la
  ventana. La bitácora sigue siendo append-only para la APLICACIÓN; la poda es una
  política de retención del operador, no una vía de edición.
- ``notification_retention_days`` — elimina las notificaciones LEÍDAS más antiguas
  que la ventana. Las NO leídas nunca se podan: una alerta operativa pendiente no
  debe desaparecer por vieja.

Idempotente y silencioso sin trabajo. Lo invoca la tarea diaria de Taskiq
(``maintenance.retention``); también puede ejecutarse a mano.
"""

import logging
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import delete
from sqlmodel import Session

from backend.app.models.audit_event import AuditEvent
from backend.app.models.notification import Notification
from backend.app.services.system_settings_service import get_system_settings
from backend.app.utils.utc_now import utc_now

logger = logging.getLogger("backend.maintenance")


@dataclass(frozen=True)
class RetentionResult:
    audit_deleted: int
    notifications_deleted: int


def run_retention(session: Session) -> RetentionResult:
    """Aplica ambas retenciones y devuelve cuántas filas eliminó cada una.

    SIN commit: el llamador decide la transacción (la tarea commitea; los tests
    inspeccionan antes de confirmar).
    """
    config = get_system_settings(session)
    now = utc_now()

    audit_deleted = 0
    if config.audit_retention_days is not None:
        cutoff = now - timedelta(days=config.audit_retention_days)
        result = session.execute(delete(AuditEvent).where(AuditEvent.occurred_at < cutoff))
        audit_deleted = int(result.rowcount or 0)

    notifications_deleted = 0
    if config.notification_retention_days is not None:
        cutoff = now - timedelta(days=config.notification_retention_days)
        result = session.execute(
            delete(Notification).where(
                Notification.read_at.isnot(None),  # las no leídas nunca se podan
                Notification.created_at < cutoff,
            )
        )
        notifications_deleted = int(result.rowcount or 0)

    if audit_deleted or notifications_deleted:
        logger.info(
            "retention pruned audit=%s notifications=%s", audit_deleted, notifications_deleted
        )
    return RetentionResult(audit_deleted=audit_deleted, notifications_deleted=notifications_deleted)
