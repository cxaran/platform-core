import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.models.base import Base


class UserIdentity(Base):
    """Identidad EXTERNA vinculada a un usuario (social login).

    Tabla genérica por diseño: hoy sólo se registra ``provider="google"``, pero un
    proveedor nuevo no exige migración. La clave real de identidad es el ``subject``
    estable del proveedor (el ``sub`` del id_token), nunca el correo — el correo se
    guarda sólo como referencia de auditoría del momento del vínculo.
    """

    __tablename__ = "user_identities"
    __table_args__ = (
        UniqueConstraint("provider", "subject", name="uq_user_identities_provider_subject"),
        Index("ix_user_identities_user", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    provider: Mapped[str] = mapped_column(
        String(40),
        nullable=False,
        comment="Proveedor de identidad (google, …).",
    )
    subject: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="Identificador ESTABLE del usuario en el proveedor (claim sub).",
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user.id", ondelete="RESTRICT"),
        nullable=False,
        comment="Usuario de la plataforma al que pertenece esta identidad.",
    )
    email_at_link: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="Correo reportado por el proveedor al momento del vínculo (referencia).",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        nullable=False,
        comment="Momento del vínculo.",
    )
