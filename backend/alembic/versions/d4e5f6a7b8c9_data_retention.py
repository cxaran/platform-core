"""Retención de datos operativos: poda de auditoría y notificaciones.

``audit_events`` y ``notifications`` crecían sin límite. Dos políticas editables en
runtime (NULL = sin poda, el comportamiento histórico); la tarea diaria de
mantenimiento (Taskiq) aplica la retención configurada.

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-07-12
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, Sequence[str], None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "system_settings",
        sa.Column(
            "audit_retention_days", sa.Integer(), nullable=True,
            comment=(
                "Días a conservar en la bitácora de auditoría; la poda diaria "
                "elimina lo más antiguo. NULL = sin poda (crecimiento sin límite)."
            ),
        ),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "notification_retention_days", sa.Integer(), nullable=True,
            comment=(
                "Días a conservar las notificaciones LEÍDAS; la poda diaria elimina "
                "las leídas más antiguas (las no leídas nunca se podan). NULL = sin poda."
            ),
        ),
    )
    op.create_check_constraint(
        "system_settings_audit_retention_positive",
        "system_settings",
        "audit_retention_days IS NULL OR audit_retention_days > 0",
    )
    op.create_check_constraint(
        "system_settings_notification_retention_positive",
        "system_settings",
        "notification_retention_days IS NULL OR notification_retention_days > 0",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        "system_settings_notification_retention_positive", "system_settings", type_="check"
    )
    op.drop_constraint(
        "system_settings_audit_retention_positive", "system_settings", type_="check"
    )
    op.drop_column("system_settings", "notification_retention_days")
    op.drop_column("system_settings", "audit_retention_days")
