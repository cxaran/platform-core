"""Configuración del SISTEMA (singleton editable por administradores).

Hogar persistente de la política de plataforma que antes vivía sólo en variables de
entorno: el backend es la fuente de verdad y los cambios quedan auditados (quién y
cuándo). Cubre registro público, dominio base verificado, nombre institucional y
correo saliente. Las fases siguientes añaden columnas TIPADAS por dominio; nunca un
key-value genérico.

Patrón singleton: una fila garantizada por CHECK sobre ``singleton_key``. La fila se
siembra en la migración (importando el valor vigente de ``REGISTRATION_ENABLED`` una
sola vez) y en el bootstrap HTTP se actualiza con las decisiones del asistente.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.models.base import Base


class SystemSettings(Base):
    """Fila ÚNICA de configuración del sistema (política editable en runtime)."""

    __tablename__ = "system_settings"
    __table_args__ = (
        CheckConstraint("singleton_key = true", name="system_settings_singleton"),
        CheckConstraint(
            "email_mode in ('environment', 'smtp', 'resend')",
            name="system_settings_email_mode",
        ),
        CheckConstraint(
            "login_verification_mode in ('disabled', 'code', 'link')",
            name="system_settings_login_verification_mode",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    singleton_key: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        unique=True,
        comment="Siempre true: fuerza una sola fila de configuración del sistema.",
    )

    public_registration_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment=(
            "Política de registro público (auto-registro por correo). Efectiva sólo "
            "si el despliegue lo permite (gate REGISTRATION_ALLOWED del entorno)."
        ),
    )

    app_base_url: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment=(
            "Dominio base confirmado de la instalación (https://…), usado para "
            "calcular redirect URIs. Se AÑADE a los orígenes confiables del entorno, "
            "nunca los reemplaza."
        ),
    )
    app_base_url_verified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        nullable=True,
        comment="Momento (UTC) en que el dominio base se verificó; lo escribe el backend.",
    )

    institution_name: Mapped[Optional[str]] = mapped_column(
        String(200),
        nullable=True,
        comment="Nombre de la institución (membrete y encabezados).",
    )

    login_verification_mode: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
        default="disabled",
        comment=(
            "Segundo paso de login verificado por correo: disabled, code (código de "
            "un solo uso) o link (enlace). Los usuarios con cobertura administrativa "
            "completa quedan exentos SIEMPRE (garantía anti-bloqueo); los clientes "
            "Bearer no re-verifican."
        ),
    )

    password_reset_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        comment=(
            "Recuperación de contraseña por correo. Sin candado de despliegue (bajo "
            "riesgo); apagarla con registro cerrado y un solo admin puede dejar la "
            "instalación sin acceso (salida: seed CLI)."
        ),
    )

    # -- Correo saliente (política editable; secretos SIEMPRE cifrados) -------------
    email_mode: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="environment",
        comment=(
            "Transporte de correo: environment (SMTP_* del entorno; Mailpit en dev), "
            "smtp (credenciales de esta fila) o resend (API key de esta fila)."
        ),
    )
    email_from_address: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="Remitente para los modos smtp/resend (environment usa SMTP_FROM_*).",
    )
    email_from_name: Mapped[Optional[str]] = mapped_column(
        String(120),
        nullable=True,
        comment="Nombre visible del remitente (modos smtp/resend).",
    )
    email_smtp_host: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True, comment="Servidor SMTP (modo smtp)."
    )
    email_smtp_port: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, comment="Puerto SMTP (modo smtp)."
    )
    email_smtp_username: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True, comment="Usuario SMTP (modo smtp)."
    )
    email_smtp_password_ciphertext: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Contraseña SMTP CIFRADA (Fernet). Nunca se proyecta a la API.",
    )
    email_smtp_tls: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, comment="STARTTLS (modo smtp)."
    )
    email_smtp_ssl: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, comment="SSL/TLS directo (modo smtp)."
    )
    email_resend_api_key_ciphertext: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="API key de Resend CIFRADA (Fernet). Nunca se proyecta a la API.",
    )
    email_last_test_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        nullable=True,
        comment="Momento (UTC) del último correo de prueba; lo escribe la acción de test.",
    )
    email_last_test_status: Mapped[Optional[str]] = mapped_column(
        String(20),
        nullable=True,
        comment="Resultado del último test: ok o failed (estado derivado, no editable).",
    )
    email_last_test_error: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="Resumen SEGURO del fallo del último test (sin credenciales).",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, nullable=True, onupdate=func.now()
    )
    updated_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user.id", ondelete="RESTRICT"),
        nullable=True,
        comment="Último administrador que modificó la configuración.",
    )
