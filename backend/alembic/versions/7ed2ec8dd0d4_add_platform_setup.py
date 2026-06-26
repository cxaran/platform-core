"""add platform setup

Revision ID: 7ed2ec8dd0d4
Revises: ebf33ec14f29
Create Date: 2026-06-26 00:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "7ed2ec8dd0d4"
down_revision: Union[str, Sequence[str], None] = "ebf33ec14f29"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "platform_setup",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column(
            "completed_at",
            sa.DateTime(),
            nullable=True,
            comment="Fecha y hora de cierre permanente del Bootstrap HTTP.",
        ),
        sa.Column(
            "completed_by_user_id",
            sa.UUID(),
            nullable=True,
            comment="Usuario inicial que completo el Bootstrap HTTP, si aplica.",
        ),
        sa.Column(
            "system_admin_role_id",
            sa.UUID(),
            nullable=True,
            comment="Rol administrador fundacional protegido por el core.",
        ),
        sa.Column(
            "completion_origin",
            sa.String(),
            nullable=True,
            comment="Origen del cierre: bootstrap de producto o instalacion legacy.",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
            comment="Fecha y hora de creacion del estado de instalacion.",
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=True,
            comment="Fecha y hora de la ultima modificacion.",
        ),
        sa.CheckConstraint("id = 1", name="ck_platform_setup_singleton"),
        sa.CheckConstraint(
            "status in ('pending', 'completed')",
            name="ck_platform_setup_status",
        ),
        sa.CheckConstraint(
            "completion_origin is null or completion_origin in ('bootstrap', 'legacy')",
            name="ck_platform_setup_completion_origin",
        ),
        sa.ForeignKeyConstraint(
            ["completed_by_user_id"], ["user.id"], name="fk_platform_setup_completed_by_user_id_user", ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["system_admin_role_id"], ["role.id"], name="fk_platform_setup_system_admin_role_id_role", ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_platform_setup"),
    )

    op.execute(
        sa.text(
            """
            INSERT INTO platform_setup (
                id,
                status,
                completed_at,
                completion_origin,
                created_at
            )
            SELECT
                1,
                CASE WHEN EXISTS (SELECT 1 FROM "user") THEN 'completed' ELSE 'pending' END,
                CASE WHEN EXISTS (SELECT 1 FROM "user") THEN now() ELSE NULL END,
                CASE WHEN EXISTS (SELECT 1 FROM "user") THEN 'legacy' ELSE NULL END,
                now()
            """
        )
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("platform_setup")
