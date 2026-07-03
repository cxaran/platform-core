"""Respaldos cifrados hacia Google Drive: configuración singleton, acciones y historial.

El router NO contiene lógica de respaldo: valida sesión/permisos/entrada y delega en
``services/backup_service``. Permisos: ``backups:read`` (ver configuración e historial)
y ``backups:configure`` (editar, conectar/desconectar Drive y respaldo manual). El
callback OAuth exige la MISMA sesión del administrador que inició la conexión (el
state, además, expira en 10 minutos y se consume una sola vez).
"""

import logging
import re
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, status
from fastapi.responses import RedirectResponse, StreamingResponse
from sqlmodel import select

from backend.app.api.resource_actions import (
    api_error,
    get_or_404,
    paginate_resource,
    serialize,
)
from backend.app.auth.auth_dependencies import CurrentUser
from backend.app.core.database import SessionDep
from backend.app.models.backup import BackupRun, BackupSettings
from backend.app.resources.registry import BACKUP_RUNS, BACKUP_SETTINGS
from backend.app.schemas.backup import (
    BackupRunListItem,
    BackupRunRead,
    BackupSettingsListItem,
    BackupSettingsRead,
    BackupSettingsUpdate,
    ConnectDriveResponse,
    DriveBackupFileRead,
    DriveBackupFilesResponse,
)
from backend.app.schemas.pagination import OffsetPage
from backend.app.security.groups.backups import BackupPermissions
from backend.app.services.backup_crypto_service import (
    BackupCryptoError,
    age_recipient_fingerprint,
    validate_age_recipient,
)
from backend.app.services import backup_service as backups
from backend.app.services.config_audit import record_config_change
from backend.app.services.google_drive_service import (
    DriveReauthError,
    DriveTemporaryError,
)
from backend.app.services.email_service import send_system_email
from backend.app.utils.utc_now import utc_now

logger = logging.getLogger("backend.backups")

router = APIRouter(tags=["backups"])

_SETTINGS_NOT_FOUND = "Configuración de respaldos no encontrada"
_RUN_NOT_FOUND = "Ejecución de respaldo no encontrada"

# Pantalla del frontend a la que vuelve el callback OAuth (resultado NO sensible).
_FRONTEND_BACKUPS_PATH = "/backups"


def _serialize_settings(session, row) -> BackupSettingsRead:  # type: ignore[no-untyped-def]
    """Read con los campos CALCULADOS (secret configurado y redirect derivado)."""
    from backend.app.api.resource_actions import serialize_with

    return serialize_with(
        BackupSettingsRead,
        row,
        {
            "google_drive_client_secret_configured": row.google_drive_client_secret_ciphertext
            is not None,
            "google_drive_redirect_uri": backups.resolve_drive_redirect_uri(session),
        },
    )


async def _send_settings_email(session, email_to: str, row) -> None:  # type: ignore[no-untyped-def]
    """Correo con la configuración aplicada y, si el sistema generó la clave de
    cifrado, la identidad privada (para que nunca se pierda). Best-effort: un fallo
    del transporte no revierte el cambio de configuración."""
    subject, body = backups.backup_settings_email(row, backups.stored_identity_plain(row))
    await send_system_email(session, subject=subject, email_to=email_to, message=body)


@router.get("/backup-settings", response_model=OffsetPage[BackupSettingsListItem])
def list_backup_settings(
    session: SessionDep,
    query: Annotated[BACKUP_SETTINGS.Query, Query()],  # pyright: ignore[reportInvalidTypeForm]
    _: BackupPermissions.READ.requiere,
) -> OffsetPage[BackupSettingsListItem]:
    # Singleton: la "lista" devuelve una sola fila (la UI genérica la renderiza igual).
    return paginate_resource(BACKUP_SETTINGS, session, query)


@router.get("/backup-settings/{item_id}", response_model=BackupSettingsRead)
def get_backup_settings_detail(
    item_id: UUID,
    session: SessionDep,
    _: BackupPermissions.READ.requiere,
) -> BackupSettingsRead:
    row = get_or_404(session, BackupSettings, item_id, _SETTINGS_NOT_FOUND)
    return _serialize_settings(session, row)


@router.patch("/backup-settings/{item_id}", response_model=BackupSettingsRead)
async def update_backup_settings(
    item_id: UUID,
    payload: BackupSettingsUpdate,
    session: SessionDep,
    current_user: CurrentUser,
    _: BackupPermissions.CONFIGURE.requiere,
) -> BackupSettingsRead:
    """Edita la configuración. Reglas de fondo: zona IANA real, recipient de age
    UTILIZABLE (se valida invocando age), y ``enabled=true`` sólo con la
    configuración completa. Cambios de horario recalculan ``next_run_at``."""
    row = get_or_404(session, BackupSettings, item_id, _SETTINGS_NOT_FOUND)
    data = payload.model_dump(exclude_unset=True)
    changed_field_names = list(data.keys())

    if "timezone" in data:
        try:
            backups.validate_timezone_name(data["timezone"])
        except ValueError as error:
            api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_timezone", str(error))
    if "filename_prefix" in data:
        try:
            backups.validate_filename_prefix(data["filename_prefix"])
        except ValueError as error:
            api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_filename_prefix", str(error))
    if "age_recipient" in data and data["age_recipient"] is not None:
        try:
            validate_age_recipient(data["age_recipient"])
        except BackupCryptoError as error:
            api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, error.code, error.summary)
        row.age_recipient_fingerprint = age_recipient_fingerprint(data["age_recipient"])
    if "age_recipient" in data and data["age_recipient"] != row.age_recipient:
        # Recipient nuevo (externo o borrado): la identidad guardada por el sistema ya
        # no corresponde a esa clave y se olvida (el admin externo tiene su privada).
        row.age_identity_ciphertext = None
        if data["age_recipient"] is None:
            row.age_recipient_fingerprint = None

    # Secreto WRITE-ONLY del cliente OAuth de Google: cifrar/borrar/conservar —
    # ANTES del setattr genérico (no existe como columna en claro).
    if "google_drive_client_secret" in data:
        from backend.app.services.secret_cipher import SecretCipherError, encrypt_secret

        secret_value = data.pop("google_drive_client_secret")
        try:
            row.google_drive_client_secret_ciphertext = (
                encrypt_secret(secret_value) if secret_value else None
            )
        except SecretCipherError as error:
            api_error(status.HTTP_409_CONFLICT, error.code, error.summary)

    for field, value in data.items():
        setattr(row, field, value)

    if row.enabled:
        missing = backups.missing_configuration(row)
        if missing:
            api_error(
                status.HTTP_409_CONFLICT,
                "configuration_incomplete",
                "No se pueden activar los respaldos; falta: " + ", ".join(sorted(missing)) + ".",
            )

    # El horario editable gobierna el próximo respaldo: cualquier cambio relevante
    # (o la activación) recalcula next_run_at; deshabilitado no programa nada.
    if row.enabled:
        row.next_run_at = backups.calculate_next_run_at(
            utc_now(), row.timezone, row.daily_time
        )
    else:
        row.next_run_at = None

    row.updated_by = current_user.id
    session.add(row)
    record_config_change(
        session,
        actor_user_id=current_user.id,
        entity_type="backup_settings",
        entity_id=row.id,
        action="backup_settings_updated",
        changed_fields=changed_field_names,
    )
    session.commit()
    session.refresh(row)
    # Cada cambio de configuración se notifica por correo al administrador que lo
    # hizo, incluyendo la clave de cifrado si el sistema la generó (requisito del
    # dueño: que la clave que abre los respaldos nunca se pierda).
    await _send_settings_email(session, current_user.email, row)
    return _serialize_settings(session, row)


@router.post(
    "/backup-settings/{item_id}/generate-encryption-key",
    response_model=BackupSettingsRead,
)
async def generate_encryption_key(
    item_id: UUID,
    session: SessionDep,
    current_user: CurrentUser,
    _: BackupPermissions.CONFIGURE.requiere,
) -> BackupSettingsRead:
    """Genera el par de claves age EN EL SISTEMA y activa el cifrado. La identidad
    privada viaja por CORREO al administrador (y queda guardada cifrada para
    reenviarse en cada cambio); la API nunca la devuelve."""
    row = get_or_404(session, BackupSettings, item_id, _SETTINGS_NOT_FOUND)
    try:
        backups.generate_encryption_key(session, current_user.id)
    except BackupCryptoError as error:
        api_error(status.HTTP_409_CONFLICT, error.code, error.summary)
    except backups.BackupPermanentError as error:
        # Sin BACKUP_TOKEN_ENCRYPTION_KEY no hay dónde guardar la identidad cifrada.
        api_error(status.HTTP_409_CONFLICT, error.code, error.summary)
    record_config_change(
        session,
        actor_user_id=current_user.id,
        entity_type="backup_settings",
        entity_id=row.id,
        action="backup_encryption_key_generated",
        changed_fields=["age_recipient", "age_identity_ciphertext"],
    )
    session.commit()
    session.refresh(row)
    await _send_settings_email(session, current_user.email, row)
    return _serialize_settings(session, row)


@router.post(
    "/backup-settings/{item_id}/connect-drive", response_model=ConnectDriveResponse
)
def connect_drive(
    item_id: UUID,
    session: SessionDep,
    current_user: CurrentUser,
    _: BackupPermissions.CONFIGURE.requiere,
) -> ConnectDriveResponse:
    get_or_404(session, BackupSettings, item_id, _SETTINGS_NOT_FOUND)
    try:
        url = backups.start_drive_connection(session, current_user.id)
    except backups.BackupPermanentError as error:
        api_error(status.HTTP_409_CONFLICT, error.code, error.summary)
    session.commit()
    return ConnectDriveResponse(authorization_url=url)


@router.get("/backups/google-drive/callback")
async def google_drive_callback(
    session: SessionDep,
    current_user: CurrentUser,
    _: BackupPermissions.CONFIGURE.requiere,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    """Callback OAuth de Google. Redirige a la pantalla de respaldos del frontend con
    un resultado NO sensible (?drive=connected|error)."""
    if error or not code or not state:
        # El usuario canceló el consent o Google reportó error: sin cambios de estado.
        return RedirectResponse(
            url=f"{_FRONTEND_BACKUPS_PATH}?drive=error", status_code=status.HTTP_302_FOUND
        )
    try:
        backups.complete_drive_connection(session, state=state, code=code)
        row = backups.get_backup_settings(session)
        record_config_change(
            session,
            actor_user_id=current_user.id,
            entity_type="backup_settings",
            entity_id=row.id,
            action="backup_drive_connected",
            changed_fields=["drive_status", "drive_folder_id"],
        )
        session.commit()
        await _send_settings_email(session, current_user.email, row)
    except backups.BackupPermanentError:
        session.rollback()
        # El motivo exacto queda en logs; a la URL sólo viaja el desenlace.
        logger.warning("drive_oauth_callback_failed")
        return RedirectResponse(
            url=f"{_FRONTEND_BACKUPS_PATH}?drive=error", status_code=status.HTTP_302_FOUND
        )
    return RedirectResponse(
        url=f"{_FRONTEND_BACKUPS_PATH}?drive=connected", status_code=status.HTTP_302_FOUND
    )


@router.post(
    "/backup-settings/{item_id}/disconnect-drive", response_model=BackupSettingsRead
)
async def disconnect_drive(
    item_id: UUID,
    session: SessionDep,
    current_user: CurrentUser,
    _: BackupPermissions.CONFIGURE.requiere,
) -> BackupSettingsRead:
    get_or_404(session, BackupSettings, item_id, _SETTINGS_NOT_FOUND)
    row = backups.disconnect_drive(session, current_user.id)
    record_config_change(
        session,
        actor_user_id=current_user.id,
        entity_type="backup_settings",
        entity_id=row.id,
        action="backup_drive_disconnected",
        changed_fields=["drive_status"],
    )
    session.commit()
    session.refresh(row)
    await _send_settings_email(session, current_user.email, row)
    return _serialize_settings(session, row)


@router.post("/backup-settings/{item_id}/run-now", response_model=BackupRunRead)
async def run_backup_now(
    item_id: UUID,
    session: SessionDep,
    _: BackupPermissions.CONFIGURE.requiere,
) -> BackupRunRead:
    """Encola un respaldo manual y despierta el tick (si el broker no está arriba, el
    tick del siguiente minuto lo toma igual: la cola es la verdad)."""
    row = get_or_404(session, BackupSettings, item_id, _SETTINGS_NOT_FOUND)
    missing = backups.missing_configuration(row)
    if missing:
        api_error(
            status.HTTP_409_CONFLICT,
            "configuration_incomplete",
            "No se puede respaldar; falta: " + ", ".join(sorted(missing)) + ".",
        )
    run = backups.enqueue_manual_run(session)
    session.commit()
    session.refresh(run)

    try:
        from backend.app.jobs.tasks.backups import backups_tick

        await backups_tick.kiq()
    except Exception:
        # No fatal: el run ya es durable y el tick programado lo procesará.
        logger.warning("backups_tick_kick_failed run_id=%s", run.id)

    return serialize(BackupRunRead, run)


@router.get("/backup-runs", response_model=OffsetPage[BackupRunListItem])
def list_backup_runs(
    session: SessionDep,
    query: Annotated[BACKUP_RUNS.Query, Query()],  # pyright: ignore[reportInvalidTypeForm]
    _: BackupPermissions.READ.requiere,
) -> OffsetPage[BackupRunListItem]:
    return paginate_resource(BACKUP_RUNS, session, query, stmt=select(BackupRun))


@router.get("/backup-runs/{item_id}", response_model=BackupRunRead)
def get_backup_run(
    item_id: UUID,
    session: SessionDep,
    _: BackupPermissions.READ.requiere,
) -> BackupRunRead:
    row = session.get(BackupRun, item_id)
    if row is None:
        api_error(status.HTTP_404_NOT_FOUND, "resource_not_found", _RUN_NOT_FOUND)
    return serialize(BackupRunRead, row)


# -- Archivos reales en Google Drive (fase inicial del explorador) -----------------


def _drive_or_conflict(session: SessionDep):  # type: ignore[no-untyped-def]
    """Cliente Drive + carpeta desde la conexión guardada, o 409 legible."""
    config = backups.get_backup_settings(session)
    try:
        client = backups.drive_client_from_config(session, config)
    except backups.BackupPermanentError as error:
        api_error(status.HTTP_409_CONFLICT, error.code, error.summary)
    assert config.drive_folder_id is not None  # garantizado por drive_client_from_config
    return client, config.drive_folder_id


def _remote_to_read(remote) -> DriveBackupFileRead:  # type: ignore[no-untyped-def]
    return DriveBackupFileRead(
        file_id=remote.file_id,
        name=remote.name,
        size_bytes=remote.size_bytes,
        created_time=remote.created_time,
        artifact_kind=remote.artifact_kind or "restore",
        backup_run_id=remote.run_id,
    )


@router.get("/backups/drive-files", response_model=DriveBackupFilesResponse)
def list_drive_backup_files(
    session: SessionDep,
    _: BackupPermissions.READ.requiere,
) -> DriveBackupFilesResponse:
    """Archivos REALES de la carpeta de respaldos en la cuenta de Drive conectada
    (nombre, tipo, fecha y tamaño; más reciente primero)."""
    client, folder_id = _drive_or_conflict(session)
    try:
        remotes = client.list_backups(folder_id)
    except DriveReauthError as error:
        api_error(status.HTTP_409_CONFLICT, error.code, error.summary)
    except DriveTemporaryError as error:
        api_error(status.HTTP_502_BAD_GATEWAY, error.code, error.summary)
    return DriveBackupFilesResponse(
        folder_id=folder_id, files=[_remote_to_read(r) for r in remotes]
    )


@router.get("/backups/drive-files/{file_id}/download")
def download_drive_backup_file(
    file_id: str,
    session: SessionDep,
    _: BackupPermissions.READ.requiere,
) -> StreamingResponse:
    """Descarga en STREAMING de un archivo de la carpeta de respaldos. Sólo sirve
    archivos que pertenezcan a la carpeta configurada (aunque el scope drive.file ya
    acota a archivos de la app, se valida la pertenencia explícitamente)."""
    client, folder_id = _drive_or_conflict(session)
    try:
        found = client.get_backup_file(file_id)
    except DriveReauthError as error:
        api_error(status.HTTP_409_CONFLICT, error.code, error.summary)
    except DriveTemporaryError as error:
        api_error(status.HTTP_502_BAD_GATEWAY, error.code, error.summary)
    if found is None:
        api_error(status.HTTP_404_NOT_FOUND, "backup_file_not_found", "Archivo no encontrado.")
    remote, parents = found
    if folder_id not in parents:
        api_error(
            status.HTTP_404_NOT_FOUND,
            "backup_file_not_found",
            "El archivo no pertenece a la carpeta de respaldos.",
        )

    # El nombre viene de nuestros propios uploads (prefijo validado), pero se sanea
    # igualmente para el header (sin CR/LF ni comillas).
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", remote.name or "respaldo.bin")
    headers = {"Content-Disposition": f'attachment; filename="{safe_name}"'}
    if remote.size_bytes is not None:
        headers["Content-Length"] = str(remote.size_bytes)
    return StreamingResponse(
        client.download_chunks(remote.file_id),
        media_type="application/octet-stream",
        headers=headers,
    )
