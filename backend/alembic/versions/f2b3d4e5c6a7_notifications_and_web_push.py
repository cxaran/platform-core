"""Notificaciones persistentes por usuario (campana + correo + Web Push).

Cada fila es UNA notificación para UN usuario y llega por TRES medios: la
campana (``read_at``), un correo (cola ``email_status``) y un Web Push a los
dispositivos suscritos (cola ``push_status``, misma máquina de estados). Ambas
colas se despachan por hilo best-effort post-commit y por el tick Taskiq.

Base genérica: ``kind`` admite ``system`` (dirigida) y ``promo`` (difusión del
administrador). Web Push: ``push_subscriptions`` por navegador y el par VAPID
autogenerado del despliegue en ``web_push_credentials`` (privada cifrada).

Revision ID: f2b3d4e5c6a7
Revises: f1a2c3d4e5b6
Create Date: 2026-07-06
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "f2b3d4e5c6a7"
down_revision: Union[str, Sequence[str], None] = "f1a2c3d4e5b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("title", sa.String(length=140), nullable=False),
        sa.Column("body", sa.String(length=500), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("email_status", sa.String(length=10), nullable=False),
        sa.Column("email_error", sa.String(length=200), nullable=True),
        sa.Column("push_status", sa.String(length=10), nullable=False),
        sa.Column("push_error", sa.String(length=200), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind IN ('system', 'promo')", name="notifications_kind"
        ),
        sa.CheckConstraint(
            "email_status IN ('pending', 'sent', 'failed', 'skipped')",
            name="notifications_email_status",
        ),
        sa.CheckConstraint(
            "push_status IN ('pending', 'sent', 'failed', 'skipped')",
            name="notifications_push_status",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notifications_user_read", "notifications", ["user_id", "read_at"])
    op.create_index(
        "ix_notifications_email_pending", "notifications", ["email_status", "created_at"]
    )
    op.create_index(
        "ix_notifications_push_pending", "notifications", ["push_status", "created_at"]
    )

    op.create_table(
        "push_subscriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.String(length=255), nullable=False),
        sa.Column("auth", sa.String(length=255), nullable=False),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint"),
    )
    op.create_index("ix_push_subscriptions_user", "push_subscriptions", ["user_id"])

    op.create_table(
        "web_push_credentials",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("public_key", sa.String(length=255), nullable=False),
        sa.Column("private_key_encrypted", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("web_push_credentials")
    op.drop_index("ix_push_subscriptions_user", table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
    op.drop_index("ix_notifications_push_pending", table_name="notifications")
    op.drop_index("ix_notifications_email_pending", table_name="notifications")
    op.drop_index("ix_notifications_user_read", table_name="notifications")
    op.drop_table("notifications")
    # Limpieza best-effort del permiso del grupo (dejaría de existir en código).
    op.execute("DELETE FROM role_access WHERE access = 'notifications:send'")
