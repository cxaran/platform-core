"""Notificaciones persistentes por usuario (campana in-app + correo + push).

Cada fila es UNA notificación para UN usuario y llega por TRES medios: la
campana del sitio/panel (lectura por ``read_at``), un correo (cola por
``email_status``) y un Web Push a los dispositivos suscritos (cola por
``push_status``, misma máquina de estados). Ambas colas se despachan
best-effort por hilo post-commit y por el tick Taskiq como red de seguridad.

Tipos (base genérica; cada proyecto añade los suyos si lo necesita):

- ``system`` → aviso dirigido a un usuario o a quienes tienen cierto permiso.
- ``promo``  → difusión del administrador (``notifications:send``).
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

NOTIFICATION_KINDS = ("system", "promo")
EMAIL_STATUSES = ("pending", "sent", "failed", "skipped")
PUSH_STATUSES = EMAIL_STATUSES


def _in_clause(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint(_in_clause("kind", NOTIFICATION_KINDS), name="notifications_kind"),
        CheckConstraint(
            _in_clause("email_status", EMAIL_STATUSES), name="notifications_email_status"
        ),
        CheckConstraint(
            _in_clause("push_status", PUSH_STATUSES), name="notifications_push_status"
        ),
        Index("ix_notifications_user_read", "user_id", "read_at"),
        Index("ix_notifications_email_pending", "email_status", "created_at"),
        Index("ix_notifications_push_pending", "push_status", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(140), nullable=False)
    body: Mapped[str] = mapped_column(String(500), nullable=False)
    # Destino OPCIONAL al tocar la notificación (ruta interna o URL https). None =
    # sin destino navegable. Cada proyecto puede además derivar el destino del tipo.
    link_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    email_status: Mapped[str] = mapped_column(String(10), nullable=False, default="pending")
    email_error: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    push_status: Mapped[str] = mapped_column(String(10), nullable=False, default="pending")
    push_error: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
