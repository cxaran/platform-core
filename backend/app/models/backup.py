import uuid
from datetime import datetime, time
from typing import Any, Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Time,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.types import JSON
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.models.base import Base
from backend.app.models.enums import (
    BackupDriveStatus,
    BackupExplorerStatus,
    BackupRunStatus,
    BackupTriggerKind,
    enum_values,
)


class BackupSettings(Base):
    """Configuración SINGLETON de respaldos cifrados hacia Google Drive.

    Una sola fila (``singleton_key`` único y con CHECK a ``true``), sembrada por la
    migración con los respaldos DESACTIVADOS. El horario editable vive aquí
    (``timezone`` IANA + ``daily_time`` local), no en el scheduler de Taskiq: el tick
    fijo por minuto consulta ``next_run_at`` (UTC) y sólo procesa trabajo vencido.

    El ``drive_refresh_token_ciphertext`` es el refresh token de Google cifrado con la
    clave Fernet del despliegue (BACKUP_TOKEN_ENCRYPTION_KEY); NUNCA se proyecta a la
    API. Del cifrado del ARCHIVO sólo se guarda el recipient PÚBLICO de age (la clave
    privada vive fuera del sistema, con el administrador). Fechas en UTC naive, como
    todo el esquema (convención del repo; ``utc_now``).
    """

    __tablename__ = "backup_settings"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    singleton_key: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
        unique=True,
        comment="Siempre true: garantiza una sola fila de configuración.",
    )

    enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
        comment="Respaldos diarios habilitados (requiere Drive activo y cifrado configurado).",
    )
    timezone: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        comment="Zona horaria IANA en la que se interpreta la hora diaria (p. ej. America/Monterrey).",
    )
    daily_time: Mapped[time] = mapped_column(
        Time,
        nullable=False,
        comment="Hora local del respaldo diario (en la zona configurada).",
    )
    next_run_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        nullable=True,
        comment="Próxima ejecución programada, en UTC (la calcula el backend, no el usuario).",
    )

    filename_prefix: Mapped[str] = mapped_column(
        String(48),
        nullable=False,
        comment="Prefijo del nombre de archivo del respaldo (letras/números/_/-).",
    )

    retention_daily_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="Copias diarias a conservar en Drive (0-365).",
    )
    retention_monthly_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="Copias mensuales a conservar en Drive (0-120).",
    )
    retention_yearly_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        comment="Copias anuales a conservar en Drive (0-50).",
    )

    age_recipient: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Recipient PÚBLICO de age con el que se cifra el archivo (la clave privada vive fuera del sistema).",
    )
    age_recipient_fingerprint: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
        comment="Huella (sha256 truncado) del recipient configurado, para mostrar y auditar.",
    )
    age_identity_ciphertext: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment=(
            "Identidad PRIVADA de age CIFRADA (Fernet), sólo si el par lo generó el "
            "sistema. Nunca se proyecta a la API; se reenvía por correo al administrador."
        ),
    )

    google_drive_client_id: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="Client ID del OAuth de Google (editable en la UI; el entorno actúa como fallback).",
    )
    google_drive_client_secret_ciphertext: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Client secret del OAuth de Google CIFRADO (Fernet). Nunca se proyecta a la API.",
    )
    explorer_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="Genera el artefacto de exploración (SQLite legible) junto a cada respaldo.",
    )

    drive_status: Mapped[BackupDriveStatus] = mapped_column(
        SAEnum(
            BackupDriveStatus,
            name="backup_drive_status",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
            values_callable=enum_values,
        ),
        nullable=False,
        default=BackupDriveStatus.DISCONNECTED,
        server_default=BackupDriveStatus.DISCONNECTED.value,
        comment="Estado de la conexión con Google Drive: disconnected, active o needs_reauth.",
    )
    drive_refresh_token_ciphertext: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Refresh token de Google CIFRADO (Fernet). Nunca se proyecta a la API.",
    )
    drive_folder_id: Mapped[Optional[str]] = mapped_column(
        String(128),
        nullable=True,
        comment="Carpeta de Drive creada por la app donde se suben los respaldos.",
    )
    drive_connected_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        nullable=True,
        comment="Fecha y hora (UTC) de la última conexión de Drive.",
    )

    last_error_code: Mapped[Optional[str]] = mapped_column(
        String(96),
        nullable=True,
        comment="Código del último error visible al administrador (alerta persistente).",
    )
    last_error_summary: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="Resumen SEGURO del último error (sin tokens, rutas ni datos clínicos).",
    )
    last_error_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        nullable=True,
        comment="Fecha y hora (UTC) del último error registrado.",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        nullable=False,
        comment="Fecha de creación de la configuración.",
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        onupdate=func.now(),
        nullable=True,
        comment="Fecha y hora de la última edición.",
    )
    updated_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user.id", ondelete="RESTRICT"),
        nullable=True,
        comment="Usuario que actualizó la configuración.",
    )

    __table_args__ = (
        CheckConstraint("singleton_key = true", name="backup_settings_singleton"),
        CheckConstraint(
            "retention_daily_count >= 0 AND retention_daily_count <= 365",
            name="backup_settings_retention_daily_range",
        ),
        CheckConstraint(
            "retention_monthly_count >= 0 AND retention_monthly_count <= 120",
            name="backup_settings_retention_monthly_range",
        ),
        CheckConstraint(
            "retention_yearly_count >= 0 AND retention_yearly_count <= 50",
            name="backup_settings_retention_yearly_range",
        ),
    )


class BackupOauthState(Base):
    """Estado efímero del flujo OAuth de Google Drive (validación del callback).

    Guarda únicamente el SHA-256 del ``state`` (nunca el valor, nunca el authorization
    code). Expira a los 10 minutos y se consume UNA sola vez; los expirados se purgan
    al crear uno nuevo.
    """

    __tablename__ = "backup_oauth_states"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user.id", ondelete="RESTRICT"),
        nullable=False,
        comment="Administrador que inició la conexión de Drive.",
    )
    state_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,
        comment="SHA-256 (hex) del state OAuth; nunca se guarda el valor original.",
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        comment="Expiración del state (UTC): 10 minutos desde su creación.",
    )
    consumed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        nullable=True,
        comment="Momento (UTC) en que el callback consumió el state (una sola vez).",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        nullable=False,
        comment="Fecha de creación del state.",
    )


class BackupRun(Base):
    """Ejecución de respaldo (historial funcional y fuente de verdad de reintentos).

    El tick de Taskiq reclama filas vencidas con lease (``FOR UPDATE SKIP LOCKED``);
    los reintentos viven aquí (``next_attempt_at``/``attempt_count``), no en Taskiq.
    NUNCA guarda refresh tokens, rutas temporales, credenciales, argumentos completos
    de pg_dump, texto crudo de errores de Google ni contenido clínico: sólo metadata
    operativa segura.
    """

    __tablename__ = "backup_runs"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    status: Mapped[BackupRunStatus] = mapped_column(
        SAEnum(
            BackupRunStatus,
            name="backup_run_status",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
            values_callable=enum_values,
        ),
        nullable=False,
        default=BackupRunStatus.QUEUED,
        server_default=BackupRunStatus.QUEUED.value,
        comment="Estado: queued, running, retrying, succeeded, failed, skipped o pruned.",
    )
    trigger_kind: Mapped[BackupTriggerKind] = mapped_column(
        SAEnum(
            BackupTriggerKind,
            name="backup_trigger_kind",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
            values_callable=enum_values,
        ),
        nullable=False,
        comment="Origen de la ejecución: scheduled (horario diario) o manual.",
    )

    scheduled_for: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        nullable=True,
        comment="Ventana programada (UTC) que originó la ejecución, si fue scheduled.",
    )
    next_attempt_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        nullable=True,
        comment="Momento (UTC) a partir del cual la ejecución puede reclamarse (cola y reintentos).",
    )
    attempt_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
        comment="Intentos realizados (máximo BACKUP_MAX_ATTEMPTS).",
    )
    lease_expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        nullable=True,
        comment="Vencimiento (UTC) del lease del worker; al expirar, la ejecución es recuperable.",
    )

    started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        nullable=True,
        comment="Inicio (UTC) del primer intento.",
    )
    finished_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        nullable=True,
        comment="Fin (UTC) del intento que dejó la ejecución en estado terminal.",
    )

    file_name: Mapped[Optional[str]] = mapped_column(
        String(160),
        nullable=True,
        comment="Nombre final del archivo cifrado subido ({prefix}-{timestampUTC}-{runId}.tar.age).",
    )
    file_size_bytes: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        nullable=True,
        comment="Tamaño del archivo cifrado subido, en bytes.",
    )
    ciphertext_sha256: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
        comment="SHA-256 (hex) del archivo cifrado (verificación e idempotencia de subida).",
    )

    drive_file_id: Mapped[Optional[str]] = mapped_column(
        String(128),
        nullable=True,
        comment="Id del archivo en Google Drive.",
    )
    drive_folder_id: Mapped[Optional[str]] = mapped_column(
        String(128),
        nullable=True,
        comment="Carpeta de Drive donde quedó el archivo.",
    )

    encryption_fingerprint: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
        comment="Huella del recipient de age usado para cifrar este respaldo.",
    )
    retention_roles: Mapped[list[Any]] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"),
        nullable=False,
        default=list,
        server_default="[]",
        comment="Roles de retención del respaldo: daily, monthly y/o yearly.",
    )

    error_code: Mapped[Optional[str]] = mapped_column(
        String(96),
        nullable=True,
        comment="Código del último error de la ejecución (clasificado, sin texto crudo).",
    )
    error_summary: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="Resumen SEGURO del último error (sin tokens, rutas ni datos clínicos).",
    )

    pruned_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        nullable=True,
        comment="Momento (UTC) en que la retención borró el archivo remoto (la fila se conserva).",
    )

    # -- Artefacto de EXPLORACIÓN (SQLite legible del mismo snapshot). Estado propio:
    # -- un explorer fallido NUNCA invalida un respaldo restaurable correcto.
    explorer_status: Mapped[Optional[BackupExplorerStatus]] = mapped_column(
        SAEnum(
            BackupExplorerStatus,
            name="backup_explorer_status",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
            values_callable=enum_values,
        ),
        nullable=True,
        comment="Estado del artefacto de exploración: not_requested, building, ready o failed.",
    )
    explorer_file_name: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="Nombre del SQLite de exploración subido ({prefix}-{ts}-{run}.explorer.sqlite[.age]).",
    )
    explorer_file_size_bytes: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        nullable=True,
        comment="Tamaño del artefacto de exploración subido, en bytes.",
    )
    explorer_ciphertext_sha256: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
        comment="SHA-256 (hex) del artefacto de exploración subido.",
    )
    explorer_drive_file_id: Mapped[Optional[str]] = mapped_column(
        String(128),
        nullable=True,
        comment="Id del artefacto de exploración en Google Drive.",
    )
    explorer_policy_version: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment="Versión de la política de exportación con la que se construyó el explorer.",
    )
    explorer_created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        nullable=True,
        comment="Momento (UTC) en que el artefacto de exploración quedó listo.",
    )
    explorer_error_code: Mapped[Optional[str]] = mapped_column(
        String(96),
        nullable=True,
        comment="Código del error del explorer (clasificado, sin texto crudo).",
    )
    explorer_error_summary: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="Resumen SEGURO del error del explorer (sin datos clínicos ni secretos).",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        nullable=False,
        comment="Fecha de creación de la ejecución.",
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        onupdate=func.now(),
        nullable=True,
        comment="Fecha y hora de la última actualización.",
    )

    __table_args__ = (
        Index("ix_backup_runs_status_next_attempt", "status", "next_attempt_at"),
        Index("ix_backup_runs_status_finished", "status", "finished_at"),
        Index("ix_backup_runs_drive_file", "drive_file_id"),
    )
