"""Credenciales de proveedor de IA (copiloto agéntico).

Tabla ``ai_provider_credentials``: credencial de proveedor de IA por usuario, con el
secreto cifrado en reposo (Fernet). La usa el puente interno de arriendo del Agent
Gateway. Enums ``provider``/``credential_type`` como VARCHAR + CHECK (no nativos).

Revision ID: a1b2c3d4e5f6
Revises: f3c4e5d6a7b8
Create Date: 2026-07-09
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "f3c4e5d6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "ai_provider_credentials",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "user_id", postgresql.UUID(as_uuid=True), nullable=False,
            comment="Usuario dueño de la credencial.",
        ),
        sa.Column(
            "provider",
            sa.Enum(
                "openai", "anthropic", "gemini", "openrouter", "ollama",
                name="ai_provider", native_enum=False, create_constraint=True,
            ),
            nullable=False,
            comment="Proveedor de IA de la credencial.",
        ),
        sa.Column(
            "credential_type",
            sa.Enum(
                "api_key", "oauth",
                name="ai_credential_type", native_enum=False, create_constraint=True,
            ),
            nullable=False,
            server_default="api_key",
            comment="Tipo de credencial: api_key (secreto estático) u oauth (perfil cifrado).",
        ),
        sa.Column(
            "label", sa.String(length=120), nullable=False,
            comment="Etiqueta legible elegida por el usuario para identificar la credencial.",
        ),
        sa.Column(
            "secret_encrypted", sa.Text(), nullable=False,
            comment="Secreto del proveedor cifrado con Fernet (NUNCA el claro).",
        ),
        sa.Column(
            "is_active", sa.Boolean(), nullable=False,
            comment="Si la credencial está habilitada para usarse.",
        ),
        sa.Column(
            "default_model", sa.String(length=160), nullable=True,
            comment="Modelo por defecto sugerido para esta credencial.",
        ),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.text("now()"),
            nullable=False, comment="Fecha de creación de la credencial.",
        ),
        sa.Column(
            "created_by", postgresql.UUID(as_uuid=True), nullable=True,
            comment="Usuario que creó la credencial.",
        ),
        sa.Column(
            "updated_at", sa.DateTime(), nullable=True,
            comment="Última actualización de la credencial.",
        ),
        sa.Column(
            "updated_by", postgresql.UUID(as_uuid=True), nullable=True,
            comment="Usuario que modificó la credencial.",
        ),
        sa.Column(
            "deleted_at", sa.DateTime(), nullable=True,
            comment="Fecha de eliminación lógica de la credencial.",
        ),
        sa.Column(
            "deleted_by", postgresql.UUID(as_uuid=True), nullable=True,
            comment="Usuario que eliminó lógicamente la credencial.",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by"], ["user.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["updated_by"], ["user.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["deleted_by"], ["user.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_ai_provider_credentials_user", "ai_provider_credentials", ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_ai_provider_credentials_provider", "ai_provider_credentials", ["provider"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_ai_provider_credentials_provider", table_name="ai_provider_credentials")
    op.drop_index("ix_ai_provider_credentials_user", table_name="ai_provider_credentials")
    op.drop_table("ai_provider_credentials")
