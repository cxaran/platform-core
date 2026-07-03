"""Bitácora de auditoría append-only (audit_events).

Registra quién accedió/cambió qué y cuándo. ``changed_fields`` lleva SOLO
nombres de campos (nunca valores): un secreto no puede filtrarse a la bitácora.

Revision ID: a3f8c21d9b47
Revises: 7ed2ec8dd0d4
Create Date: 2026-07-03
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a3f8c21d9b47"
down_revision: Union[str, Sequence[str], None] = "7ed2ec8dd0d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "audit_events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "entity_type",
            sa.String(length=120),
            nullable=False,
            comment="Tabla o tipo de entidad afectada por el evento.",
        ),
        sa.Column(
            "entity_id",
            sa.UUID(),
            nullable=False,
            comment="Identificador del registro afectado.",
        ),
        sa.Column(
            "action",
            sa.String(length=120),
            nullable=False,
            comment="Acción realizada, por ejemplo system_settings_updated o backup_drive_connected.",
        ),
        sa.Column(
            "actor_user_id",
            sa.UUID(),
            nullable=True,
            comment="Usuario que ejecutó la acción. Puede ser nulo para procesos automáticos del sistema.",
        ),
        sa.Column(
            "changed_fields",
            postgresql.JSONB(astext_type=sa.Text()).with_variant(sa.JSON(), "sqlite"),
            nullable=True,
            comment="Resumen de los campos modificados.",
        ),
        sa.Column(
            "reason",
            sa.Text(),
            nullable=True,
            comment="Motivo del evento, cuando aplique.",
        ),
        sa.Column(
            "occurred_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
            comment="Fecha y hora del evento de auditoría.",
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["user.id"],
            name=op.f("fk_audit_events_actor_user_id_user"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_events")),
    )
    op.create_index("ix_audit_events_action", "audit_events", ["action"], unique=False)
    op.create_index(
        "ix_audit_events_actor_user", "audit_events", ["actor_user_id"], unique=False
    )
    op.create_index(
        "ix_audit_events_entity", "audit_events", ["entity_type", "entity_id"], unique=False
    )
    op.create_index(
        "ix_audit_events_occurred_at", "audit_events", ["occurred_at"], unique=False
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_audit_events_occurred_at", table_name="audit_events")
    op.drop_index("ix_audit_events_entity", table_name="audit_events")
    op.drop_index("ix_audit_events_actor_user", table_name="audit_events")
    op.drop_index("ix_audit_events_action", table_name="audit_events")
    op.drop_table("audit_events")
