"""Respaldos configurables hacia Google Drive (módulo completo).

Tablas del módulo de respaldos cifrados hacia Google Drive: configuración singleton
(backup_settings, sembrada con los respaldos DESACTIVADOS), estados efímeros del flujo
OAuth (backup_oauth_states) e historial de ejecuciones (backup_runs), incluidos los
campos del artefacto de EXPLORACIÓN (SQLite legible) y las credenciales OAuth
capturables en la UI. No modifica ninguna tabla existente. La tabla del broker de
Taskiq NO se migra aquí (la crea el propio broker).

Revision ID: c8e1f4a29d63
Revises: b4c7d92e8a15
Create Date: 2026-07-03
"""
import os
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "c8e1f4a29d63"
down_revision: Union[str, Sequence[str], None] = "b4c7d92e8a15"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _env_explorer_enabled() -> bool:
    raw = os.environ.get("BACKUP_EXPLORER_ENABLED", "false").strip().lower()
    return raw in ("1", "true", "yes", "on")


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "backup_settings",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("singleton_key", sa.Boolean(), server_default="true", nullable=False, comment="Siempre true: garantiza una sola fila de configuración."),
        sa.Column("enabled", sa.Boolean(), server_default="false", nullable=False, comment="Respaldos diarios habilitados (requiere Drive activo y cifrado configurado)."),
        sa.Column("timezone", sa.String(length=64), nullable=False, comment="Zona horaria IANA en la que se interpreta la hora diaria (p. ej. America/Monterrey)."),
        sa.Column("daily_time", sa.Time(), nullable=False, comment="Hora local del respaldo diario (en la zona configurada)."),
        sa.Column("next_run_at", sa.DateTime(), nullable=True, comment="Próxima ejecución programada, en UTC (la calcula el backend, no el usuario)."),
        sa.Column("filename_prefix", sa.String(length=48), nullable=False, comment="Prefijo del nombre de archivo del respaldo (letras/números/_/-)."),
        sa.Column("retention_daily_count", sa.Integer(), nullable=False, comment="Copias diarias a conservar en Drive (0-365)."),
        sa.Column("retention_monthly_count", sa.Integer(), nullable=False, comment="Copias mensuales a conservar en Drive (0-120)."),
        sa.Column("retention_yearly_count", sa.Integer(), nullable=False, comment="Copias anuales a conservar en Drive (0-50)."),
        sa.Column("age_recipient", sa.Text(), nullable=True, comment="Recipient PÚBLICO de age con el que se cifra el archivo (la clave privada vive fuera del sistema)."),
        sa.Column("age_recipient_fingerprint", sa.String(length=64), nullable=True, comment="Huella (sha256 truncado) del recipient configurado, para mostrar y auditar."),
        sa.Column("age_identity_ciphertext", sa.Text(), nullable=True, comment="Identidad PRIVADA de age CIFRADA (Fernet), sólo si el par lo generó el sistema. Nunca se proyecta a la API; se reenvía por correo al administrador."),
        sa.Column("drive_status", sa.Enum("disconnected", "active", "needs_reauth", name="backup_drive_status", native_enum=False, create_constraint=True), server_default="disconnected", nullable=False, comment="Estado de la conexión con Google Drive: disconnected, active o needs_reauth."),
        sa.Column("drive_refresh_token_ciphertext", sa.Text(), nullable=True, comment="Refresh token de Google CIFRADO (Fernet). Nunca se proyecta a la API."),
        sa.Column("drive_folder_id", sa.String(length=128), nullable=True, comment="Carpeta de Drive creada por la app donde se suben los respaldos."),
        sa.Column("drive_connected_at", sa.DateTime(), nullable=True, comment="Fecha y hora (UTC) de la última conexión de Drive."),
        sa.Column("google_drive_client_id", sa.String(length=255), nullable=True, comment="Client ID del OAuth de Google (editable en la UI; el entorno actúa como fallback)."),
        sa.Column("google_drive_client_secret_ciphertext", sa.Text(), nullable=True, comment="Client secret del OAuth de Google CIFRADO (Fernet). Nunca se proyecta a la API."),
        sa.Column("explorer_enabled", sa.Boolean(), nullable=False, server_default=("true" if _env_explorer_enabled() else "false"), comment="Genera el artefacto de exploración (SQLite legible) junto a cada respaldo."),
        sa.Column("last_error_code", sa.String(length=96), nullable=True, comment="Código del último error visible al administrador (alerta persistente)."),
        sa.Column("last_error_summary", sa.String(length=255), nullable=True, comment="Resumen SEGURO del último error (sin tokens ni rutas)."),
        sa.Column("last_error_at", sa.DateTime(), nullable=True, comment="Fecha y hora (UTC) del último error registrado."),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False, comment="Fecha de creación de la configuración."),
        sa.Column("updated_at", sa.DateTime(), nullable=True, comment="Fecha y hora de la última edición."),
        sa.Column("updated_by", sa.UUID(), nullable=True, comment="Usuario que actualizó la configuración."),
        sa.CheckConstraint("retention_daily_count >= 0 AND retention_daily_count <= 365", name=op.f("ck_backup_settings_backup_settings_retention_daily_range")),
        sa.CheckConstraint("retention_monthly_count >= 0 AND retention_monthly_count <= 120", name=op.f("ck_backup_settings_backup_settings_retention_monthly_range")),
        sa.CheckConstraint("retention_yearly_count >= 0 AND retention_yearly_count <= 50", name=op.f("ck_backup_settings_backup_settings_retention_yearly_range")),
        sa.CheckConstraint("singleton_key = true", name=op.f("ck_backup_settings_backup_settings_singleton")),
        sa.ForeignKeyConstraint(["updated_by"], ["user.id"], name=op.f("fk_backup_settings_updated_by_user"), ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_backup_settings")),
        sa.UniqueConstraint("singleton_key", name=op.f("uq_backup_settings_singleton_key")),
    )

    op.create_table(
        "backup_oauth_states",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False, comment="Administrador que inició la conexión de Drive."),
        sa.Column("state_hash", sa.String(length=64), nullable=False, comment="SHA-256 (hex) del state OAuth; nunca se guarda el valor original."),
        sa.Column("expires_at", sa.DateTime(), nullable=False, comment="Expiración del state (UTC): 10 minutos desde su creación."),
        sa.Column("consumed_at", sa.DateTime(), nullable=True, comment="Momento (UTC) en que el callback consumió el state (una sola vez)."),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False, comment="Fecha de creación del state."),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], name=op.f("fk_backup_oauth_states_user_id_user"), ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_backup_oauth_states")),
        sa.UniqueConstraint("state_hash", name=op.f("uq_backup_oauth_states_state_hash")),
    )

    op.create_table(
        "backup_runs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("status", sa.Enum("queued", "running", "retrying", "succeeded", "failed", "skipped", "pruned", name="backup_run_status", native_enum=False, create_constraint=True), server_default="queued", nullable=False, comment="Estado: queued, running, retrying, succeeded, failed, skipped o pruned."),
        sa.Column("trigger_kind", sa.Enum("scheduled", "manual", name="backup_trigger_kind", native_enum=False, create_constraint=True), nullable=False, comment="Origen de la ejecución: scheduled (horario diario) o manual."),
        sa.Column("scheduled_for", sa.DateTime(), nullable=True, comment="Ventana programada (UTC) que originó la ejecución, si fue scheduled."),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=True, comment="Momento (UTC) a partir del cual la ejecución puede reclamarse (cola y reintentos)."),
        sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False, comment="Intentos realizados (máximo BACKUP_MAX_ATTEMPTS)."),
        sa.Column("lease_expires_at", sa.DateTime(), nullable=True, comment="Vencimiento (UTC) del lease del worker; al expirar, la ejecución es recuperable."),
        sa.Column("started_at", sa.DateTime(), nullable=True, comment="Inicio (UTC) del primer intento."),
        sa.Column("finished_at", sa.DateTime(), nullable=True, comment="Fin (UTC) del intento que dejó la ejecución en estado terminal."),
        sa.Column("file_name", sa.String(length=160), nullable=True, comment="Nombre final del archivo cifrado subido ({prefix}-{timestampUTC}-{runId}.tar.age)."),
        sa.Column("file_size_bytes", sa.BigInteger(), nullable=True, comment="Tamaño del archivo cifrado subido, en bytes."),
        sa.Column("ciphertext_sha256", sa.String(length=64), nullable=True, comment="SHA-256 (hex) del archivo cifrado (verificación e idempotencia de subida)."),
        sa.Column("drive_file_id", sa.String(length=128), nullable=True, comment="Id del archivo en Google Drive."),
        sa.Column("drive_folder_id", sa.String(length=128), nullable=True, comment="Carpeta de Drive donde quedó el archivo."),
        sa.Column("encryption_fingerprint", sa.String(length=64), nullable=True, comment="Huella del recipient de age usado para cifrar este respaldo."),
        sa.Column("retention_roles", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), server_default="[]", nullable=False, comment="Roles de retención del respaldo: daily, monthly y/o yearly."),
        sa.Column("error_code", sa.String(length=96), nullable=True, comment="Código del último error de la ejecución (clasificado, sin texto crudo)."),
        sa.Column("error_summary", sa.String(length=255), nullable=True, comment="Resumen SEGURO del último error (sin tokens ni rutas)."),
        sa.Column("pruned_at", sa.DateTime(), nullable=True, comment="Momento (UTC) en que la retención borró el archivo remoto (la fila se conserva)."),
        sa.Column("explorer_status", sa.Enum("not_requested", "building", "ready", "failed", name="backup_explorer_status", native_enum=False, create_constraint=True), nullable=True, comment="Estado del artefacto de exploración: not_requested, building, ready o failed."),
        sa.Column("explorer_file_name", sa.String(length=255), nullable=True, comment="Nombre del SQLite de exploración subido ({prefix}-{ts}-{run}.explorer.sqlite[.age])."),
        sa.Column("explorer_file_size_bytes", sa.BigInteger(), nullable=True, comment="Tamaño del artefacto de exploración subido, en bytes."),
        sa.Column("explorer_ciphertext_sha256", sa.String(length=64), nullable=True, comment="SHA-256 (hex) del artefacto de exploración subido."),
        sa.Column("explorer_drive_file_id", sa.String(length=128), nullable=True, comment="Id del artefacto de exploración en Google Drive."),
        sa.Column("explorer_policy_version", sa.Integer(), nullable=True, comment="Versión de la política de exportación con la que se construyó el explorer."),
        sa.Column("explorer_created_at", sa.DateTime(), nullable=True, comment="Momento (UTC) en que el artefacto de exploración quedó listo."),
        sa.Column("explorer_error_code", sa.String(length=96), nullable=True, comment="Código del error del explorer (clasificado, sin texto crudo)."),
        sa.Column("explorer_error_summary", sa.String(length=255), nullable=True, comment="Resumen SEGURO del error del explorer (sin datos sensibles ni secretos)."),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False, comment="Fecha de creación de la ejecución."),
        sa.Column("updated_at", sa.DateTime(), nullable=True, comment="Fecha y hora de la última actualización."),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_backup_runs")),
    )
    op.create_index("ix_backup_runs_status_next_attempt", "backup_runs", ["status", "next_attempt_at"], unique=False)
    op.create_index("ix_backup_runs_status_finished", "backup_runs", ["status", "finished_at"], unique=False)
    op.create_index("ix_backup_runs_drive_file", "backup_runs", ["drive_file_id"], unique=False)

    # Fila singleton inicial: respaldos DESACTIVADOS y Drive desconectado. El resto de
    # los valores son defaults seguros que el administrador edita desde la UI genérica.
    op.execute(
        sa.text(
            "INSERT INTO backup_settings "
            "(id, singleton_key, enabled, timezone, daily_time, filename_prefix, "
            " retention_daily_count, retention_monthly_count, retention_yearly_count, drive_status) "
            "VALUES (:id, true, false, 'UTC', '02:00', 'platform-core', 7, 12, 5, 'disconnected')"
        ).bindparams(id=str(uuid.uuid4()))
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_backup_runs_drive_file", table_name="backup_runs")
    op.drop_index("ix_backup_runs_status_finished", table_name="backup_runs")
    op.drop_index("ix_backup_runs_status_next_attempt", table_name="backup_runs")
    op.drop_table("backup_runs")
    op.drop_table("backup_oauth_states")
    op.drop_table("backup_settings")
