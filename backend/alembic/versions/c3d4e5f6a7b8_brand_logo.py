"""Logo de la instalación (marca de la PWA/manifest) en system_settings.

Binario RASTER verificado con Pillow al subir (SVG bloqueado), guardado en la BD
como el resto de la configuración (viaja con los respaldos). NULL = sin logo →
el manifest usa los íconos placeholder estáticos.

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-07-11
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, Sequence[str], None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "system_settings",
        sa.Column(
            "brand_logo_content", sa.LargeBinary(), nullable=True,
            comment="Logo de la instalación (binario raster verificado). NULL = sin logo.",
        ),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "brand_logo_mime", sa.String(length=100), nullable=True,
            comment="Content-type del logo (image/png, image/jpeg, image/webp).",
        ),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "brand_logo_updated_at", sa.DateTime(), nullable=True,
            comment="Última actualización del logo (cache-buster del manifest).",
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("system_settings", "brand_logo_updated_at")
    op.drop_column("system_settings", "brand_logo_mime")
    op.drop_column("system_settings", "brand_logo_content")
