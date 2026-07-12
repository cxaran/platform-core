"""Duración de sesión y analítica GA4 como política en system_settings.

Sesión: ``customer_session_days`` (cliente sin roles) y ``staff_session_minutes``
(personal con roles); NULL = heredar el default del despliegue
(CUSTOMER_SESSION_EXPIRE_DAYS / ACCESS_TOKEN_EXPIRE_MINUTES). La renovación
deslizante extiende ambas mientras haya actividad.

Analítica: cuatro columnas de Google Analytics 4 para un frontend público
(interruptor, ID de medición —público por diseño de Google, no es un secreto—,
exigencia de consentimiento y modo de depuración). Se siembran APAGADAS para no
cambiar el comportamiento vigente.

Revision ID: f1a2c3d4e5b6
Revises: e7b34fa8c2d9
Create Date: 2026-07-06
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f1a2c3d4e5b6"
down_revision: Union[str, Sequence[str], None] = "e7b34fa8c2d9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # -- Duración de sesión (política editable; NULL = default del despliegue) --
    op.add_column(
        "system_settings",
        sa.Column(
            "customer_session_days",
            sa.Integer(),
            nullable=True,
            comment=(
                "Días de sesión del CLIENTE (usuario sin roles). NULL = usar el default "
                "del despliegue (CUSTOMER_SESSION_EXPIRE_DAYS). La renovación deslizante "
                "extiende la sesión con la actividad."
            ),
        ),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "staff_session_minutes",
            sa.Integer(),
            nullable=True,
            comment=(
                "Minutos de sesión del PERSONAL (usuario con roles). NULL = usar el "
                "default del despliegue (ACCESS_TOKEN_EXPIRE_MINUTES)."
            ),
        ),
    )
    op.create_check_constraint(
        "system_settings_customer_session_days_positive",
        "system_settings",
        "customer_session_days IS NULL OR customer_session_days > 0",
    )
    op.create_check_constraint(
        "system_settings_staff_session_minutes_positive",
        "system_settings",
        "staff_session_minutes IS NULL OR staff_session_minutes > 0",
    )

    # -- Analítica del sitio público (GA4) --
    op.add_column(
        "system_settings",
        sa.Column(
            "analytics_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
            comment=(
                "Google Analytics 4 en el frontend público. Apagado no se carga ningún "
                "script ni se envía evento alguno."
            ),
        ),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "analytics_ga4_measurement_id",
            sa.String(length=30),
            nullable=True,
            comment="ID de medición de GA4 (G-XXXXXXXXXX); identificador público.",
        ),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "analytics_require_consent",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
            comment=(
                "Exigir consentimiento de cookies analíticas antes de cargar o "
                "enviar cualquier evento."
            ),
        ),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "analytics_debug_mode",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
            comment="Enviar eventos con debug_mode para GA4 DebugView (solo pruebas).",
        ),
    )
    # Los defaults a nivel app gobiernan las filas nuevas; el server_default solo
    # sirvió para sembrar la fila singleton existente.
    op.alter_column("system_settings", "analytics_enabled", server_default=None)
    op.alter_column("system_settings", "analytics_require_consent", server_default=None)
    op.alter_column("system_settings", "analytics_debug_mode", server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("system_settings", "analytics_debug_mode")
    op.drop_column("system_settings", "analytics_require_consent")
    op.drop_column("system_settings", "analytics_ga4_measurement_id")
    op.drop_column("system_settings", "analytics_enabled")
    op.drop_constraint(
        "system_settings_staff_session_minutes_positive", "system_settings", type_="check"
    )
    op.drop_constraint(
        "system_settings_customer_session_days_positive", "system_settings", type_="check"
    )
    op.drop_column("system_settings", "staff_session_minutes")
    op.drop_column("system_settings", "customer_session_days")
