"""Política operativa editable en runtime (system_settings + backup_settings).

Mueve a la base de datos, como política editable por administradores, variables que
antes solo vivían en el entorno. Todas NULLABLE con la convención establecida:
NULL = usar el default del despliegue (la variable de entorno sigue siendo el
fallback), así que NO se siembra ningún valor.

- system_settings: login_attempts_before_lock, email_token_minutes,
  application_timezone, agent_ticket_ttl_seconds, agent_lease_ttl_seconds.
- backup_settings: run_lease_minutes, max_attempts.

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-07-11
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "system_settings",
        sa.Column(
            "login_attempts_before_lock", sa.Integer(), nullable=True,
            comment=(
                "Intentos fallidos de login antes de bloquear la cuenta. NULL = usar "
                "el default del despliegue (TRYS_BEFORE_LOCK)."
            ),
        ),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "email_token_minutes", sa.Integer(), nullable=True,
            comment=(
                "Minutos de vigencia de los tokens enviados por correo (registro, "
                "recuperación, verificación de login). NULL = usar el default del "
                "despliegue (EMAIL_TOKEN_EXPIRE_MINUTES)."
            ),
        ),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "application_timezone", sa.String(length=64), nullable=True,
            comment=(
                "Zona horaria IANA de la instalación (p. ej. America/Monterrey): "
                "define los límites de día de los filtros de calendario. NULL = "
                "default del despliegue (APPLICATION_TIMEZONE)."
            ),
        ),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "agent_ticket_ttl_seconds", sa.Integer(), nullable=True,
            comment=(
                "Segundos de vigencia del ticket de conexión al Agent Gateway. NULL "
                "= default del despliegue (AGENT_GATEWAY_TICKET_TTL_SECONDS)."
            ),
        ),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "agent_lease_ttl_seconds", sa.Integer(), nullable=True,
            comment=(
                "Segundos de vigencia del arriendo de credencial de proveedor de IA "
                "por turno. NULL = default del despliegue "
                "(AGENT_GATEWAY_LEASE_TTL_SECONDS)."
            ),
        ),
    )
    op.create_check_constraint(
        "system_settings_login_attempts_positive",
        "system_settings",
        "login_attempts_before_lock IS NULL OR login_attempts_before_lock > 0",
    )
    op.create_check_constraint(
        "system_settings_email_token_minutes_positive",
        "system_settings",
        "email_token_minutes IS NULL OR email_token_minutes > 0",
    )
    op.create_check_constraint(
        "system_settings_agent_ticket_ttl_positive",
        "system_settings",
        "agent_ticket_ttl_seconds IS NULL OR agent_ticket_ttl_seconds > 0",
    )
    op.create_check_constraint(
        "system_settings_agent_lease_ttl_positive",
        "system_settings",
        "agent_lease_ttl_seconds IS NULL OR agent_lease_ttl_seconds > 0",
    )

    op.add_column(
        "backup_settings",
        sa.Column(
            "run_lease_minutes", sa.Integer(), nullable=True,
            comment=(
                "Minutos del lease de una ejecución RUNNING antes de considerarla "
                "huérfana y recuperarla. NULL = default del despliegue "
                "(BACKUP_RUN_LEASE_MINUTES)."
            ),
        ),
    )
    op.add_column(
        "backup_settings",
        sa.Column(
            "max_attempts", sa.Integer(), nullable=True,
            comment=(
                "Intentos máximos de una ejecución antes de marcarla fallida. NULL "
                "= default del despliegue (BACKUP_MAX_ATTEMPTS)."
            ),
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("backup_settings", "max_attempts")
    op.drop_column("backup_settings", "run_lease_minutes")
    op.drop_constraint(
        "system_settings_agent_lease_ttl_positive", "system_settings", type_="check"
    )
    op.drop_constraint(
        "system_settings_agent_ticket_ttl_positive", "system_settings", type_="check"
    )
    op.drop_constraint(
        "system_settings_email_token_minutes_positive", "system_settings", type_="check"
    )
    op.drop_constraint(
        "system_settings_login_attempts_positive", "system_settings", type_="check"
    )
    op.drop_column("system_settings", "agent_lease_ttl_seconds")
    op.drop_column("system_settings", "agent_ticket_ttl_seconds")
    op.drop_column("system_settings", "application_timezone")
    op.drop_column("system_settings", "email_token_minutes")
    op.drop_column("system_settings", "login_attempts_before_lock")
