"""Notificaciones: enlace opcional (destino al tocar la notificación).

``link_url`` guarda una ruta interna o URL https OPCIONAL; la campana y el Web
Push la usan como destino al tocar la notificación. Nullable, sin default.

Revision ID: f3c4e5d6a7b8
Revises: f2b3d4e5c6a7
Create Date: 2026-07-06
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f3c4e5d6a7b8"
down_revision: Union[str, Sequence[str], None] = "f2b3d4e5c6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "notifications", sa.Column("link_url", sa.String(length=500), nullable=True)
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("notifications", "link_url")
