"""Singleton system_settings (política del sistema editable en runtime).

Crea el singleton con la política completa (registro público, dominio verificado,
institución, recuperación de contraseña y correo saliente) y lo SIEMBRA importando
UNA sola vez los valores vigentes de REGISTRATION_ENABLED y PASSWORD_RESET_ENABLED
del entorno (a partir de aquí la base de datos es la fuente de verdad de esas
políticas). Añade platform_setup.onboarding_dismissed_at y lo backfillea NO nulo
para instalaciones ya completadas (a un despliegue que ya opera no se le muestra el
checklist inicial).

Revision ID: b4c7d92e8a15
Revises: a3f8c21d9b47
Create Date: 2026-07-03
"""
import os
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

# revision identifiers, used by Alembic.
revision: str = "b4c7d92e8a15"
down_revision: Union[str, Sequence[str], None] = "a3f8c21d9b47"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _env_flag(name: str, default: str) -> bool:
    raw = os.environ.get(name, default).strip().lower()
    return raw in ("1", "true", "yes", "on")


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "system_settings",
        sa.Column("id", PG_UUID(as_uuid=True), nullable=False),
        sa.Column(
            "singleton_key",
            sa.Boolean(),
            nullable=False,
            comment="Siempre true: fuerza una sola fila de configuración del sistema.",
        ),
        sa.Column(
            "public_registration_enabled",
            sa.Boolean(),
            nullable=False,
            comment=(
                "Política de registro público (auto-registro por correo). Efectiva sólo "
                "si el despliegue lo permite (gate REGISTRATION_ALLOWED del entorno)."
            ),
        ),
        sa.Column(
            "app_base_url",
            sa.String(length=255),
            nullable=True,
            comment=(
                "Dominio base confirmado de la instalación (https://…), usado para "
                "calcular redirect URIs. Se AÑADE a los orígenes confiables del entorno, "
                "nunca los reemplaza."
            ),
        ),
        sa.Column(
            "app_base_url_verified_at",
            sa.DateTime(),
            nullable=True,
            comment="Momento (UTC) en que el dominio base se verificó; lo escribe el backend.",
        ),
        sa.Column(
            "institution_name",
            sa.String(length=200),
            nullable=True,
            comment="Nombre de la institución (membrete y encabezados).",
        ),
        sa.Column(
            "password_reset_enabled",
            sa.Boolean(),
            nullable=False,
            comment=(
                "Recuperación de contraseña por correo. Sin candado de despliegue (bajo "
                "riesgo); apagarla con registro cerrado y un solo admin puede dejar la "
                "instalación sin acceso (salida: seed CLI)."
            ),
        ),
        sa.Column(
            "email_mode",
            sa.String(length=20),
            nullable=False,
            server_default="environment",
            comment=(
                "Transporte de correo: environment (SMTP_* del entorno; Mailpit en dev), "
                "smtp (credenciales de esta fila) o resend (API key de esta fila)."
            ),
        ),
        sa.Column(
            "email_from_address",
            sa.String(length=255),
            nullable=True,
            comment="Remitente para los modos smtp/resend (environment usa SMTP_FROM_*).",
        ),
        sa.Column(
            "email_from_name",
            sa.String(length=120),
            nullable=True,
            comment="Nombre visible del remitente (modos smtp/resend).",
        ),
        sa.Column(
            "email_smtp_host",
            sa.String(length=255),
            nullable=True,
            comment="Servidor SMTP (modo smtp).",
        ),
        sa.Column(
            "email_smtp_port", sa.Integer(), nullable=True, comment="Puerto SMTP (modo smtp)."
        ),
        sa.Column(
            "email_smtp_username",
            sa.String(length=255),
            nullable=True,
            comment="Usuario SMTP (modo smtp).",
        ),
        sa.Column(
            "email_smtp_password_ciphertext",
            sa.Text(),
            nullable=True,
            comment="Contraseña SMTP CIFRADA (Fernet). Nunca se proyecta a la API.",
        ),
        sa.Column(
            "email_smtp_tls",
            sa.Boolean(),
            nullable=False,
            server_default="true",
            comment="STARTTLS (modo smtp).",
        ),
        sa.Column(
            "email_smtp_ssl",
            sa.Boolean(),
            nullable=False,
            server_default="false",
            comment="SSL/TLS directo (modo smtp).",
        ),
        sa.Column(
            "email_resend_api_key_ciphertext",
            sa.Text(),
            nullable=True,
            comment="API key de Resend CIFRADA (Fernet). Nunca se proyecta a la API.",
        ),
        sa.Column(
            "email_last_test_at",
            sa.DateTime(),
            nullable=True,
            comment="Momento (UTC) del último correo de prueba; lo escribe la acción de test.",
        ),
        sa.Column(
            "email_last_test_status",
            sa.String(length=20),
            nullable=True,
            comment="Resultado del último test: ok o failed (estado derivado, no editable).",
        ),
        sa.Column(
            "email_last_test_error",
            sa.String(length=255),
            nullable=True,
            comment="Resumen SEGURO del fallo del último test (sin credenciales).",
        ),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column(
            "updated_by",
            PG_UUID(as_uuid=True),
            nullable=True,
            comment="Último administrador que modificó la configuración.",
        ),
        sa.CheckConstraint(
            "singleton_key = true",
            name=op.f("ck_system_settings_system_settings_singleton"),
        ),
        sa.CheckConstraint(
            "email_mode in ('environment', 'smtp', 'resend')",
            name=op.f("ck_system_settings_system_settings_email_mode"),
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["user.id"],
            name=op.f("fk_system_settings_updated_by_user"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_system_settings")),
        sa.UniqueConstraint("singleton_key", name=op.f("uq_system_settings_singleton_key")),
    )

    # Siembra del singleton: importa la política vigente del entorno UNA sola vez.
    registration = "true" if _env_flag("REGISTRATION_ENABLED", "false") else "false"
    password_reset = "true" if _env_flag("PASSWORD_RESET_ENABLED", "true") else "false"
    op.execute(
        "INSERT INTO system_settings "
        "(id, singleton_key, public_registration_enabled, password_reset_enabled) "
        f"VALUES (gen_random_uuid(), true, {registration}, {password_reset})"
    )

    op.add_column(
        "platform_setup",
        sa.Column(
            "onboarding_dismissed_at",
            sa.DateTime(),
            nullable=True,
            comment=(
                "Momento (UTC) en que el administrador descartó el checklist de "
                "configuración post-bootstrap (el checklist en sí es DERIVADO del "
                "estado real, nunca persiste progreso propio)."
            ),
        ),
    )
    # Instalaciones que ya operan: no mostrarles el checklist inicial.
    op.execute(
        "UPDATE platform_setup SET onboarding_dismissed_at = now() "
        "WHERE status = 'completed'"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("platform_setup", "onboarding_dismissed_at")
    op.drop_table("system_settings")
