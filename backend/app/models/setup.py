from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class PlatformSetup(Base):
    """Estado persistente singleton de instalacion de la plataforma."""

    __tablename__ = "platform_setup"
    __table_args__ = (
        CheckConstraint("id = 1", name="ck_platform_setup_singleton"),
        CheckConstraint(
            "status in ('pending', 'completed')",
            name="ck_platform_setup_status",
        ),
        CheckConstraint(
            "completion_origin is null or completion_origin in ('bootstrap', 'legacy')",
            name="ck_platform_setup_completion_origin",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        nullable=True,
        comment="Fecha y hora de cierre permanente del Bootstrap HTTP.",
    )
    completed_by_user_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user.id", ondelete="RESTRICT"),
        nullable=True,
        comment="Usuario inicial que completo el Bootstrap HTTP, si aplica.",
    )
    system_admin_role_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("role.id", ondelete="RESTRICT"),
        nullable=True,
        comment="Rol administrador fundacional protegido por el core.",
    )
    completion_origin: Mapped[Optional[str]] = mapped_column(
        String,
        nullable=True,
        comment="Origen del cierre: bootstrap de producto o instalacion legacy.",
    )
    onboarding_dismissed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        nullable=True,
        comment=(
            "Momento (UTC) en que el administrador descartó el checklist de "
            "configuración post-bootstrap (el checklist en sí es DERIVADO del "
            "estado real, nunca persiste progreso propio)."
        ),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        nullable=False,
        comment="Fecha y hora de creacion del estado de instalacion.",
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        nullable=True,
        comment="Fecha y hora de la ultima modificacion.",
    )
