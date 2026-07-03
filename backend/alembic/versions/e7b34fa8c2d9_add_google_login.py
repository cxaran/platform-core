"""Inicio de sesión con Google: identidades externas + política/credenciales.

Crea ``user_identities`` (tabla GENÉRICA de identidades de social login: hoy sólo
``google``, un proveedor nuevo no exige migración) y añade a ``system_settings``
el flag ``google_login_enabled`` más las credenciales OAuth del login (client ID
en claro; client secret cifrado write-only con la clave maestra). El estado del
flujo OAuth es efímero en Redis: no se migra.

Revision ID: e7b34fa8c2d9
Revises: d2a90b57e4f1
Create Date: 2026-07-03
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

# revision identifiers, used by Alembic.
revision: str = "e7b34fa8c2d9"
down_revision: Union[str, Sequence[str], None] = "d2a90b57e4f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "user_identities",
        sa.Column("id", PG_UUID(as_uuid=True), nullable=False),
        sa.Column(
            "provider",
            sa.String(length=40),
            nullable=False,
            comment="Proveedor de identidad (google, …).",
        ),
        sa.Column(
            "subject",
            sa.String(length=255),
            nullable=False,
            comment="Identificador ESTABLE del usuario en el proveedor (claim sub).",
        ),
        sa.Column(
            "user_id",
            PG_UUID(as_uuid=True),
            nullable=False,
            comment="Usuario de la plataforma al que pertenece esta identidad.",
        ),
        sa.Column(
            "email_at_link",
            sa.String(length=255),
            nullable=True,
            comment="Correo reportado por el proveedor al momento del vínculo (referencia).",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
            comment="Momento del vínculo.",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user.id"],
            name=op.f("fk_user_identities_user_id_user"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_identities")),
        sa.UniqueConstraint(
            "provider", "subject", name="uq_user_identities_provider_subject"
        ),
    )
    op.create_index("ix_user_identities_user", "user_identities", ["user_id"], unique=False)

    op.add_column(
        "system_settings",
        sa.Column(
            "google_login_enabled",
            sa.Boolean(),
            nullable=False,
            server_default="false",
            comment=(
                "Botón 'Continuar con Google' en el login. Vincula cuentas por correo "
                "VERIFICADO de Google; el alta de cuentas nuevas exige además el "
                "registro público efectivo (mismo doble candado que el registro)."
            ),
        ),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "google_auth_client_id",
            sa.String(length=255),
            nullable=True,
            comment="Client ID del OAuth de Google para el LOGIN (distinto del de respaldos).",
        ),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "google_auth_client_secret_ciphertext",
            sa.Text(),
            nullable=True,
            comment="Client secret del OAuth de login CIFRADO (Fernet). Nunca se proyecta a la API.",
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("system_settings", "google_auth_client_secret_ciphertext")
    op.drop_column("system_settings", "google_auth_client_id")
    op.drop_column("system_settings", "google_login_enabled")
    op.drop_index("ix_user_identities_user", table_name="user_identities")
    op.drop_table("user_identities")
