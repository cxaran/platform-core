import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.models.base import Base
from backend.app.models.enums import AiCredentialType, AiProvider, enum_values


class AiProviderCredential(Base):
    """Credencial de proveedor de IA registrada por un usuario, cifrada en reposo.

    El secreto se guarda únicamente como ciphertext Fernet en ``secret_encrypted``;
    el claro nunca se persiste. FastAPI es la autoridad: estas credenciales no viven
    en el navegador ni durablemente en el Gateway (que las arrienda por turno)."""

    __tablename__ = "ai_provider_credentials"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user.id", ondelete="RESTRICT"),
        nullable=False,
        comment="Usuario dueño de la credencial.",
    )
    provider: Mapped[AiProvider] = mapped_column(
        SAEnum(
            AiProvider,
            name="ai_provider",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
            values_callable=enum_values,
        ),
        nullable=False,
        comment="Proveedor de IA de la credencial.",
    )
    credential_type: Mapped[AiCredentialType] = mapped_column(
        SAEnum(
            AiCredentialType,
            name="ai_credential_type",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
            values_callable=enum_values,
        ),
        nullable=False,
        default=AiCredentialType.API_KEY,
        server_default=AiCredentialType.API_KEY.value,
        comment="Tipo de credencial: api_key (secreto estático) u oauth (perfil cifrado).",
    )
    label: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
        comment="Etiqueta legible elegida por el usuario para identificar la credencial.",
    )
    secret_encrypted: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        comment="Secreto del proveedor cifrado con Fernet (NUNCA el claro).",
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        comment="Si la credencial está habilitada para usarse.",
    )
    default_model: Mapped[Optional[str]] = mapped_column(
        String(160),
        nullable=True,
        comment="Modelo por defecto sugerido para esta credencial.",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        nullable=False,
        comment="Fecha de creación de la credencial.",
    )
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user.id", ondelete="RESTRICT"),
        nullable=True,
        comment="Usuario que creó la credencial.",
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        onupdate=func.now(),
        nullable=True,
        comment="Última actualización de la credencial.",
    )
    updated_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user.id", ondelete="RESTRICT"),
        nullable=True,
        comment="Usuario que modificó la credencial.",
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, nullable=True, comment="Fecha de eliminación lógica de la credencial."
    )
    deleted_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user.id", ondelete="RESTRICT"),
        nullable=True,
        comment="Usuario que eliminó lógicamente la credencial.",
    )

    owner = relationship("User", foreign_keys=[user_id])
    created_by_user = relationship("User", foreign_keys=[created_by])
    updated_by_user = relationship("User", foreign_keys=[updated_by])
    deleted_by_user = relationship("User", foreign_keys=[deleted_by])

    __table_args__ = (
        Index("ix_ai_provider_credentials_user", "user_id"),
        Index("ix_ai_provider_credentials_provider", "provider"),
    )
