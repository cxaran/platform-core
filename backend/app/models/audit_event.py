import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.models.base import Base


class AuditEvent(Base):
    """Evento de auditoría append-only de la operación del sistema."""

    __tablename__ = "audit_events"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    entity_type: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
        comment="Tabla o tipo de entidad afectada por el evento.",
    )
    entity_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
        comment="Identificador del registro afectado.",
    )
    action: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
        comment="Acción realizada, por ejemplo system_settings_updated o backup_drive_connected.",
    )
    actor_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user.id", ondelete="RESTRICT"),
        nullable=True,
        comment="Usuario que ejecutó la acción. Puede ser nulo para procesos automáticos del sistema.",
    )
    changed_fields: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSONB().with_variant(JSON(), "sqlite"),
        nullable=True,
        comment="Resumen de los campos modificados.",
    )
    reason: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True, comment="Motivo del evento, cuando aplique."
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        nullable=False,
        comment="Fecha y hora del evento de auditoría.",
    )

    actor_user = relationship("User", foreign_keys=[actor_user_id])

    __table_args__ = (
        Index("ix_audit_events_entity", "entity_type", "entity_id"),
        Index("ix_audit_events_action", "action"),
        Index("ix_audit_events_actor_user", "actor_user_id"),
        Index("ix_audit_events_occurred_at", "occurred_at"),
    )
