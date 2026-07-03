"""Schemas de respaldos cifrados hacia Google Drive.

La configuración es SINGLETON (una fila) y su lectura NUNCA proyecta el refresh token
cifrado. Los campos de Drive (estado, carpeta, conexión), la huella del recipient, el
``next_run_at`` y la alerta persistente (``last_error_*``) son de SOLO LECTURA: los
gobierna el backend (OAuth, tick y desenlaces), no el formulario.
"""

import uuid
from datetime import datetime, time
from typing import Any, Optional

from pydantic import Field

from backend.app.models.enums import (
    BackupDriveStatus,
    BackupExplorerStatus,
    BackupRunStatus,
    BackupTriggerKind,
)
from backend.app.schemas.base import ApiPatchSchema, ApiReadSchema


class BackupSettingsUpdate(ApiPatchSchema):
    """Actualización parcial de la configuración de respaldos (campos EDITABLES).

    Las validaciones de fondo (zona IANA real, recipient de age utilizable, requisitos
    para ``enabled=true``) viven en el router/servicio; aquí van los rangos y formas.
    """

    enabled: Optional[bool] = Field(
        default=None,
        title="Habilitado",
        description="Respaldo diario habilitado (requiere Drive conectado y cifrado configurado).",
        # "switch": el widget booleano del contrato (WidgetType no tiene "checkbox";
        # un valor fuera del enum tira TODO el catálogo /resources con 500).
        json_schema_extra={"ui": {"form": True, "widget": "switch"}},
    )
    timezone: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=64,
        title="Zona horaria",
        description="Zona IANA en la que se interpreta la hora diaria (p. ej. America/Monterrey).",
        json_schema_extra={"ui": {"form": True, "widget": "text"}},
    )
    daily_time: Optional[time] = Field(
        default=None,
        title="Hora diaria",
        description="Hora local del respaldo diario.",
        json_schema_extra={"ui": {"form": True, "widget": "text"}},
    )
    filename_prefix: Optional[str] = Field(
        default=None,
        min_length=2,
        max_length=48,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{1,47}$",
        title="Prefijo del archivo",
        description="2-48 caracteres; letras, números, guion y guion bajo; inicia alfanumérico.",
        json_schema_extra={"ui": {"form": True, "widget": "text"}},
    )
    retention_daily_count: Optional[int] = Field(
        default=None,
        ge=0,
        le=365,
        title="Copias diarias",
        json_schema_extra={"ui": {"form": True, "widget": "number"}},
    )
    retention_monthly_count: Optional[int] = Field(
        default=None,
        ge=0,
        le=120,
        title="Copias mensuales",
        json_schema_extra={"ui": {"form": True, "widget": "number"}},
    )
    retention_yearly_count: Optional[int] = Field(
        default=None,
        ge=0,
        le=50,
        title="Copias anuales",
        json_schema_extra={"ui": {"form": True, "widget": "number"}},
    )
    explorer_enabled: Optional[bool] = Field(
        default=None,
        title="Artefacto de exploración",
        description="Genera el SQLite legible junto a cada respaldo (mismo snapshot).",
        json_schema_extra={"ui": {"form": True, "widget": "switch"}},
    )
    google_drive_client_id: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=255,
        title="Google Drive: client ID",
        description="Del cliente OAuth (tipo web) creado en Google Cloud.",
        json_schema_extra={"ui": {"form": True, "widget": "text"}},
    )
    # Secreto WRITE-ONLY: valor reemplaza, null borra, omitir conserva.
    google_drive_client_secret: Optional[str] = Field(
        default=None,
        max_length=255,
        title="Google Drive: client secret (write-only)",
        description="Se guarda cifrado; nunca vuelve a mostrarse.",
        json_schema_extra={"ui": {"form": True, "widget": "text"}},
    )
    age_recipient: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=4096,
        title="Recipient de age (clave pública, opcional)",
        description=(
            "OPCIONAL. Sin recipient el respaldo sube SIN cifrar (.tar); con la clave "
            "PÚBLICA age1… se cifra antes de subir (la privada nunca se sube)."
        ),
        json_schema_extra={"ui": {"form": True, "widget": "textarea"}},
    )


class BackupSettingsRead(ApiReadSchema):
    """Configuración completa (sin secretos: el token cifrado jamás se proyecta)."""

    id: uuid.UUID
    enabled: bool
    timezone: str
    daily_time: time
    next_run_at: Optional[datetime] = None
    filename_prefix: str
    retention_daily_count: int
    retention_monthly_count: int
    retention_yearly_count: int
    age_recipient: Optional[str] = None
    age_recipient_fingerprint: Optional[str] = None
    explorer_enabled: bool
    google_drive_client_id: Optional[str] = None
    google_drive_client_secret_configured: bool
    # Redirect URI calculado (env override o derivado del dominio verificado): la UI
    # lo muestra para copiarlo al crear el cliente en Google Cloud.
    google_drive_redirect_uri: Optional[str] = None
    drive_status: BackupDriveStatus
    drive_folder_id: Optional[str] = None
    drive_connected_at: Optional[datetime] = None
    last_error_code: Optional[str] = None
    last_error_summary: Optional[str] = None
    last_error_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    updated_by: Optional[uuid.UUID] = None


class BackupSettingsListItem(ApiReadSchema):
    """Versión de listado del singleton (una fila; la ALERTA persistente viaja aquí)."""

    id: uuid.UUID
    enabled: bool = Field(title="Habilitado", json_schema_extra={"ui": {"list": True}})
    timezone: str = Field(title="Zona horaria", json_schema_extra={"ui": {"list": True}})
    daily_time: time = Field(title="Hora diaria", json_schema_extra={"ui": {"list": True}})
    drive_status: BackupDriveStatus = Field(
        title="Google Drive", json_schema_extra={"ui": {"list": True}}
    )
    next_run_at: Optional[datetime] = Field(
        default=None, title="Próximo respaldo", json_schema_extra={"ui": {"list": True}}
    )
    last_error_code: Optional[str] = Field(
        default=None, title="Último error", json_schema_extra={"ui": {"list": True}}
    )
    last_error_at: Optional[datetime] = Field(
        default=None, title="Error registrado", json_schema_extra={"ui": {"list": True}}
    )
    # Presente para el contrato de orden del query (sin columna visible en la lista).
    created_at: datetime = Field(title="Creado")


class ConnectDriveResponse(ApiReadSchema):
    """Respuesta de la acción conectar Drive: URL de autorización de Google."""

    authorization_url: str


class DriveBackupFileRead(ApiReadSchema):
    """Archivo REAL guardado en la carpeta de respaldos de Google Drive (fase inicial
    del explorador: ver qué hay y descargarlo; sin exploración todavía)."""

    file_id: str
    name: str
    size_bytes: Optional[int] = None
    created_time: Optional[str] = None
    artifact_kind: str
    backup_run_id: Optional[str] = None


class DriveBackupFilesResponse(ApiReadSchema):
    """Listado de la carpeta de Drive (más reciente primero)."""

    folder_id: str
    files: list[DriveBackupFileRead]


class BackupRunRead(ApiReadSchema):
    """Detalle de una ejecución del historial (metadata operativa, nunca secretos)."""

    id: uuid.UUID
    status: BackupRunStatus
    trigger_kind: BackupTriggerKind
    scheduled_for: Optional[datetime] = None
    next_attempt_at: Optional[datetime] = None
    attempt_count: int
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    file_name: Optional[str] = None
    file_size_bytes: Optional[int] = None
    ciphertext_sha256: Optional[str] = None
    drive_file_id: Optional[str] = None
    drive_folder_id: Optional[str] = None
    encryption_fingerprint: Optional[str] = None
    retention_roles: list[Any]
    error_code: Optional[str] = None
    error_summary: Optional[str] = None
    pruned_at: Optional[datetime] = None
    # Artefacto de exploración (SQLite legible): estado y tamaño, de sólo lectura.
    explorer_status: Optional[BackupExplorerStatus] = None
    explorer_file_size_bytes: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


class BackupRunListItem(ApiReadSchema):
    """Versión de listado del historial de respaldos."""

    id: uuid.UUID
    status: BackupRunStatus = Field(title="Estado", json_schema_extra={"ui": {"list": True}})
    trigger_kind: BackupTriggerKind = Field(
        title="Origen", json_schema_extra={"ui": {"list": True}}
    )
    scheduled_for: Optional[datetime] = Field(
        default=None, title="Ventana", json_schema_extra={"ui": {"list": True}}
    )
    started_at: Optional[datetime] = Field(
        default=None, title="Inicio", json_schema_extra={"ui": {"list": True}}
    )
    finished_at: Optional[datetime] = Field(
        default=None, title="Fin", json_schema_extra={"ui": {"list": True}}
    )
    file_name: Optional[str] = Field(
        default=None, title="Archivo", json_schema_extra={"ui": {"list": True}}
    )
    file_size_bytes: Optional[int] = Field(
        default=None, title="Tamaño (bytes)", json_schema_extra={"ui": {"list": True}}
    )
    retention_roles: list[Any] = Field(
        title="Retención", json_schema_extra={"ui": {"list": True}}
    )
    attempt_count: int = Field(title="Intentos", json_schema_extra={"ui": {"list": True}})
    error_code: Optional[str] = Field(
        default=None, title="Error", json_schema_extra={"ui": {"list": True}}
    )
    explorer_status: Optional[BackupExplorerStatus] = Field(
        default=None, title="Explorador", json_schema_extra={"ui": {"list": True}}
    )
    explorer_file_size_bytes: Optional[int] = Field(
        default=None, title="Explorador (bytes)", json_schema_extra={"ui": {"list": True}}
    )
    created_at: datetime = Field(title="Creado", json_schema_extra={"ui": {"list": True}})
