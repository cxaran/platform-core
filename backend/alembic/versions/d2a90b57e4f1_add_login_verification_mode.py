"""Verificación de inicio de sesión por correo (system_settings).

Añade ``login_verification_mode`` al singleton: disabled (default sembrado),
code (código de un solo uso por correo) o link (enlace). Política editable en
runtime; los usuarios con cobertura administrativa completa quedan exentos
SIEMPRE y los clientes Bearer no re-verifican.

Revision ID: d2a90b57e4f1
Revises: c8e1f4a29d63
Create Date: 2026-07-03
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d2a90b57e4f1"
down_revision: Union[str, Sequence[str], None] = "c8e1f4a29d63"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "system_settings",
        sa.Column(
            "login_verification_mode",
            sa.String(length=10),
            nullable=False,
            server_default="disabled",
            comment=(
                "Segundo paso de login verificado por correo: disabled, code (código de "
                "un solo uso) o link (enlace). Los usuarios con cobertura administrativa "
                "completa quedan exentos SIEMPRE (garantía anti-bloqueo); los clientes "
                "Bearer no re-verifican."
            ),
        ),
    )
    op.create_check_constraint(
        "ck_system_settings_system_settings_login_verification_mode",
        "system_settings",
        "login_verification_mode in ('disabled', 'code', 'link')",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        "ck_system_settings_system_settings_login_verification_mode",
        "system_settings",
        type_="check",
    )
    op.drop_column("system_settings", "login_verification_mode")
