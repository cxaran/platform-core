"""Descripción pública del sitio en system_settings.

Alimenta la metadata del navegador (<meta description>) y la descripción del
manifest de la PWA; editable por el administrador en Configuración del sistema.

Revision ID: c9d0e1f2a3b4
Revises: 47047ac47de1
Create Date: 2026-07-14
"""

import sqlalchemy as sa
from alembic import op

revision = "c9d0e1f2a3b4"
down_revision = "47047ac47de1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "system_settings",
        sa.Column(
            "site_description",
            sa.String(300),
            nullable=True,
            comment=(
                "Descripción pública del sitio: metadata del navegador (<meta "
                "description>) y descripción del manifest de la PWA. Sin secretos."
            ),
        ),
    )


def downgrade() -> None:
    op.drop_column("system_settings", "site_description")
