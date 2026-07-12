"""Orquestación de respaldos cifrados hacia Google Drive.

Toda la lógica vive aquí: el router sólo valida permisos y delega; la tarea Taskiq
(``backups.tick``) sólo llama ``run_tick()``. PostgreSQL es la fuente de verdad
funcional: el horario editable está en ``backup_settings`` (timezone IANA +
``daily_time``) y los reintentos en ``backup_runs`` (``next_attempt_at`` +
``attempt_count``), nunca en Taskiq.

Flujo de un respaldo:
    pg_dump -Fc  →  pg_restore --list (verificación)  →  manifest.json  →  .tar
    →  [age con recipient público, OPCIONAL]  →  Google Drive (subida resumible)

El cifrado del archivo es OPCIONAL (decisión del dueño del producto): sin
``age_recipient`` configurado el respaldo sube SIN cifrar (extensión .tar); con
recipient, se cifra con age (.tar.age).

Clasificación de errores: ``BackupTemporaryError`` reintenta con backoff (5 min,
30 min; máximo BACKUP_MAX_ATTEMPTS); ``DriveReauthError`` DETIENE los reintentos
(drive_status=needs_reauth + alerta persistente) hasta que el administrador
reconecte; ``BackupPermanentError`` falla directo. Los resúmenes de error son
SEGUROS: jamás tokens, rutas, argumentos de pg_dump ni texto crudo de Google.
"""

import hashlib
import json
import logging
import re
import secrets
import shutil
import subprocess
import tarfile
import tempfile
import uuid
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone as dt_timezone
from pathlib import Path
from typing import Optional, Sequence
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlmodel import Session, select

from backend.app.core.database import engine
from backend.app.core.settings import settings
from backend.app.models.backup import BackupOauthState, BackupRun, BackupSettings
from backend.app.models.enums import (
    BackupDriveStatus,
    BackupExplorerStatus,
    BackupRunStatus,
    BackupTriggerKind,
)
from backend.app.services.backup_crypto_service import (
    BackupCryptoError,
    age_recipient_fingerprint,
    encrypt_file_with_age,
    sha256_of_file,
)
from backend.app.services.google_drive_service import (
    DriveReauthError,
    DriveTemporaryError,
    GoogleDriveBackupService,
)
from backend.app.utils.utc_now import utc_now

logger = logging.getLogger("backend.backups")

# Backoff de reintentos (minutos) tras el 1er y 2do fallo temporal; al agotar
# BACKUP_MAX_ATTEMPTS la ejecución queda failed. La verdad vive en backup_runs.
RETRY_DELAYS_MINUTES: tuple[int, ...] = (5, 30)

# Prefijo del archivo: 2-48, inicia alfanumérico, sólo letras/números/_/- (sin
# espacios, rutas, puntos ni caracteres de control).
_FILENAME_PREFIX_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{1,47}$")

_OAUTH_STATE_TTL = timedelta(minutes=10)
_PG_DUMP_TIMEOUT_SECONDS = 60 * 30
_PG_RESTORE_LIST_TIMEOUT_SECONDS = 60 * 5

MANIFEST_FORMAT_VERSION = 1


def source_postgres_dsn() -> str:
    """DSN plano (``postgresql://``) para conexiones directas con psycopg v3 (el DSN
    de SQLAlchemy lleva el sufijo ``+psycopg2`` que psycopg no acepta). Contiene la
    contraseña: nunca se loguea."""
    from sqlalchemy.engine import make_url

    url = make_url(str(settings.postgres_dsn))
    return url.set(drivername="postgresql").render_as_string(hide_password=False)


@contextmanager
def exported_read_snapshot() -> Generator[str]:
    """Exporta un snapshot PostgreSQL y lo mantiene ABIERTO mientras dura el bloque.

    Dentro del ``with`` se generan el dump restaurable (``pg_dump --snapshot``) y el
    explorer SQLite importando el MISMO snapshot: ambos artefactos representan
    exactamente el mismo instante de la base. Sólo se usa desde el worker (nunca
    desde FastAPI). Al salir: rollback y cierre garantizados.
    """
    import psycopg

    # autocommit=True: psycopg v3 abriría una transacción implícita en el primer
    # execute y el BEGIN manual chocaría con ella; el modo explícito la evita.
    connection = psycopg.connect(source_postgres_dsn(), autocommit=True)
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
            )
            cursor.execute("SELECT pg_export_snapshot()")
            row = cursor.fetchone()
            assert row is not None
            snapshot_id = str(row[0])
        yield snapshot_id
    finally:
        try:
            connection.rollback()
        finally:
            connection.close()


class BackupTemporaryError(Exception):
    """Fallo temporal: la ejecución reintenta con backoff hasta agotar intentos."""

    def __init__(self, code: str, summary: str) -> None:
        super().__init__(summary)
        self.code = code
        self.summary = summary


class BackupPermanentError(Exception):
    """Fallo permanente: la ejecución termina en failed sin reintentos."""

    def __init__(self, code: str, summary: str) -> None:
        super().__init__(summary)
        self.code = code
        self.summary = summary


# --------------------------------------------------------------------------------
# Funciones PURAS (testeables sin base de datos ni red)
# --------------------------------------------------------------------------------


def validate_filename_prefix(prefix: str) -> None:
    """Valida el prefijo del nombre de archivo (lanza ``ValueError`` con motivo)."""
    if not _FILENAME_PREFIX_PATTERN.fullmatch(prefix):
        raise ValueError(
            "El prefijo debe tener 2-48 caracteres, iniciar con letra o número y "
            "usar sólo letras, números, guion y guion bajo."
        )


def validate_timezone_name(name: str) -> None:
    """Valida que la zona sea IANA (lanza ``ValueError``)."""
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise ValueError(f"Zona horaria IANA inválida: {name!r}") from error


def calculate_next_run_at(now_utc: datetime, timezone: str, daily_time: time) -> datetime:
    """Próxima ocurrencia (UTC naive) de la hora local diaria configurada.

    Convierte ``now_utc`` a la zona IANA, arma la ocurrencia de HOY con
    ``daily_time`` y, si ya pasó, usa mañana. En días de cambio de horario la
    conversión de una hora inexistente/ambigua la resuelve ``zoneinfo`` (fold=0),
    de modo que siempre hay UNA ejecución por día local.
    """
    validate_timezone_name(timezone)
    zone = ZoneInfo(timezone)
    now_local = now_utc.replace(tzinfo=dt_timezone.utc).astimezone(zone)
    candidate = now_local.replace(
        hour=daily_time.hour,
        minute=daily_time.minute,
        second=daily_time.second,
        microsecond=0,
    )
    if candidate <= now_local:
        candidate = candidate + timedelta(days=1)
        # Re-anclar la hora tras sumar el día (la aritmética aware conserva la hora
        # de pared con zoneinfo, pero re-fijarla lo hace explícito y a prueba de DST).
        candidate = candidate.replace(
            hour=daily_time.hour,
            minute=daily_time.minute,
            second=daily_time.second,
            microsecond=0,
        )
    return candidate.astimezone(dt_timezone.utc).replace(tzinfo=None)


def build_backup_filename(
    prefix: str, now_utc: datetime, run_id: uuid.UUID, *, encrypted: bool
) -> str:
    """Nombre final fijo (sin plantillas libres): ``{prefix}-{timestampUTC}-{run
    corto}.tar.age`` cifrado, o ``….tar`` sin cifrar — la extensión dice honestamente
    qué contiene."""
    stamp = now_utc.strftime("%Y%m%dT%H%M%SZ")
    suffix = ".tar.age" if encrypted else ".tar"
    return f"{prefix}-{stamp}-{run_id.hex[:8]}{suffix}"


def build_explorer_filename(
    prefix: str, now_utc: datetime, run_id: uuid.UUID, *, encrypted: bool
) -> str:
    """Nombre del artefacto de EXPLORACIÓN, hermano del restaurable:
    ``{prefix}-{timestampUTC}-{run corto}.explorer.sqlite[.age]``."""
    stamp = now_utc.strftime("%Y%m%dT%H%M%SZ")
    suffix = ".explorer.sqlite.age" if encrypted else ".explorer.sqlite"
    return f"{prefix}-{stamp}-{run_id.hex[:8]}{suffix}"


def initial_explorer_status(
    config: BackupSettings,
) -> tuple[Optional[BackupExplorerStatus], Optional[int]]:
    """Estado inicial del artefacto de exploración al CREAR una ejecución. El flag
    es POLÍTICA editable (backup_settings.explorer_enabled); el env quedó sólo como
    valor de importación inicial."""
    if config.explorer_enabled:
        return BackupExplorerStatus.BUILDING, 1
    return BackupExplorerStatus.NOT_REQUESTED, None


def compute_retention_roles(*, month_taken: bool, year_taken: bool) -> list[str]:
    """Roles de retención del respaldo recién exitoso (los flags llegan evaluados en
    fechas LOCALES). Todo éxito es ``daily``; además es ``monthly`` si es el primero
    exitoso de su mes local y ``yearly`` si es el primero de su año local.
    """
    roles = ["daily"]
    if not month_taken:
        roles.append("monthly")
    if not year_taken:
        roles.append("yearly")
    return roles


@dataclass(frozen=True)
class RetentionCandidate:
    """Proyección mínima de un respaldo remoto vigente para planear la rotación."""

    run_id: uuid.UUID
    finished_at: datetime
    roles: Sequence[str]


def plan_retention_pruning(
    candidates: Sequence[RetentionCandidate],
    *,
    daily_count: int,
    monthly_count: int,
    yearly_count: int,
) -> list[uuid.UUID]:
    """Ids de respaldos remotos a PODAR según la política diaria/mensual/anual.

    Por cada rol se protegen los N más recientes que lo porten; un respaldo sólo se
    poda cuando NINGUNO de sus roles lo protege. Nunca propone podar algo protegido
    (las copias mensuales/anuales sobreviven a la rotación diaria).
    """
    ordered = sorted(candidates, key=lambda item: item.finished_at, reverse=True)
    protected: set[uuid.UUID] = set()
    for role, count in (
        ("daily", daily_count),
        ("monthly", monthly_count),
        ("yearly", yearly_count),
    ):
        kept = 0
        for item in ordered:
            if role in item.roles and kept < count:
                protected.add(item.run_id)
                kept += 1
    return [item.run_id for item in ordered if item.run_id not in protected]


def next_retry_delay_minutes(attempt_count: int, max_attempts: int) -> Optional[int]:
    """Backoff tras un fallo temporal: 5 y 30 minutos; ``None`` = sin intentos
    restantes (la ejecución pasa a failed)."""
    if attempt_count >= max_attempts:
        return None
    index = attempt_count - 1
    if index < len(RETRY_DELAYS_MINUTES):
        return RETRY_DELAYS_MINUTES[index]
    return RETRY_DELAYS_MINUTES[-1]


def missing_configuration(settings_row: BackupSettings) -> list[str]:
    """Requisitos faltantes para poder ACTIVAR/ejecutar respaldos (nombres estables
    para la API y la UI). El cifrado del archivo es OPCIONAL por decisión del dueño
    del producto: sin ``age_recipient`` el respaldo sube SIN cifrar."""
    missing: list[str] = []
    if settings_row.drive_status != BackupDriveStatus.ACTIVE:
        missing.append("drive_connection")
    if not settings_row.drive_folder_id:
        missing.append("drive_folder_id")
    from backend.app.services.secret_cipher import has_encryption_key

    if not has_encryption_key():
        missing.append("app_encryption_key")
    has_client_id = bool(settings_row.google_drive_client_id)
    has_client_secret = bool(settings_row.google_drive_client_secret_ciphertext)
    if not has_client_id or not has_client_secret:
        missing.append("google_oauth_client")
    return missing


# --------------------------------------------------------------------------------
# Cifrado del refresh token (Fernet, en reposo)
# --------------------------------------------------------------------------------


def encrypt_refresh_token(token: str) -> str:
    """Cifra el refresh token con el cifrador consolidado (clave maestra única)."""
    from backend.app.services.secret_cipher import encrypt_secret

    return encrypt_secret(token)


def decrypt_refresh_token(ciphertext: str) -> str:
    """Descifra el refresh token (cadena de claves con transición). Un material que
    no corresponde a ninguna clave es un estado terminal de reauth."""
    from backend.app.services.secret_cipher import decrypt_secret

    value = decrypt_secret(ciphertext)
    if value is None:
        raise BackupPermanentError(
            "drive_token_undecryptable",
            "El token de Drive no pudo descifrarse; reconecta Google Drive.",
        )
    return value




# --------------------------------------------------------------------------------
# OAuth de Google Drive (connect / callback / disconnect)
# --------------------------------------------------------------------------------


DRIVE_CALLBACK_PATH = "/api/v1/backups/google-drive/callback"


def resolve_drive_redirect_uri(session: Session) -> Optional[str]:
    """Redirect URI del OAuth de Drive: DERIVADO del dominio base verificado
    (``system_settings.app_base_url``); ``None`` mientras no haya dominio."""
    from backend.app.services.system_settings_service import get_system_settings

    system = get_system_settings(session)
    if system.app_base_url and system.app_base_url_verified_at is not None:
        return system.app_base_url.rstrip("/") + DRIVE_CALLBACK_PATH
    return None


def resolve_drive_oauth(session: Session) -> tuple[str, str, str]:
    """(client_id, client_secret, redirect_uri) del OAuth de Drive.

    Las credenciales viven ÚNICAMENTE en la fila (capturadas en la UI; el secret
    cifrado con la clave maestra) y el redirect se deriva del dominio verificado.
    Lanza ``BackupPermanentError`` con la causa exacta si falta algo.
    """
    config = get_backup_settings(session)
    client_id = config.google_drive_client_id
    client_secret: Optional[str] = None
    if config.google_drive_client_secret_ciphertext:
        from backend.app.services.secret_cipher import decrypt_secret

        client_secret = decrypt_secret(config.google_drive_client_secret_ciphertext)
    redirect_uri = resolve_drive_redirect_uri(session)

    missing = []
    if not client_id:
        missing.append("client ID")
    if not client_secret:
        missing.append("client secret")
    if not redirect_uri:
        missing.append("redirect URI (verifica el dominio de la instalación)")
    if missing:
        raise BackupPermanentError(
            "oauth_client_unconfigured",
            "Falta configurar el cliente OAuth de Google: " + ", ".join(missing) + ".",
        )
    assert client_id is not None and client_secret is not None and redirect_uri is not None
    return client_id, client_secret, redirect_uri


def get_backup_settings(session: Session, *, for_update: bool = False) -> BackupSettings:
    """La fila singleton (sembrada por la migración)."""
    stmt = select(BackupSettings)
    if for_update:
        stmt = stmt.with_for_update()
    row = session.exec(stmt).first()
    if row is None:
        raise BackupPermanentError(
            "settings_missing", "No existe la configuración de respaldos (migración pendiente)."
        )
    return row


def run_lease_minutes_effective(session: Session) -> int:
    """Lease (minutos) de una ejecución: política en BD o default del despliegue.

    Nunca lanza: si la fila singleton falta (instalación a medias), usa el default —
    el worker no debe morir por leer una política opcional."""
    try:
        stored = get_backup_settings(session).run_lease_minutes
    except BackupPermanentError:
        stored = None
    return stored or settings.backup_run_lease_minutes


def max_attempts_effective(session: Session) -> int:
    """Intentos máximos de una ejecución: política en BD o default del despliegue."""
    try:
        stored = get_backup_settings(session).max_attempts
    except BackupPermanentError:
        stored = None
    return stored or settings.backup_max_attempts


def start_drive_connection(session: Session, user_id: uuid.UUID) -> str:
    """Crea el state OAuth (sólo su SHA-256 se guarda) y devuelve la URL de
    autorización de Google. Purga estados expirados al crear uno nuevo."""
    client_id, _client_secret, redirect_uri = resolve_drive_oauth(session)

    now = utc_now()
    for stale in session.exec(
        select(BackupOauthState).where(BackupOauthState.expires_at < now)
    ).all():
        session.delete(stale)

    state_value = secrets.token_urlsafe(32)
    session.add(
        BackupOauthState(
            user_id=user_id,
            state_hash=hashlib.sha256(state_value.encode("utf-8")).hexdigest(),
            expires_at=now + _OAUTH_STATE_TTL,
        )
    )

    from urllib.parse import urlencode

    query = urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "https://www.googleapis.com/auth/drive.file",
            "access_type": "offline",
            "prompt": "consent",
            "state": state_value,
        }
    )
    return f"https://accounts.google.com/o/oauth2/v2/auth?{query}"


def complete_drive_connection(session: Session, *, state: str, code: str) -> None:
    """Callback OAuth: valida y consume el state, intercambia el code, exige refresh
    token, lo cifra, asegura la carpeta y activa la conexión."""
    client_id, client_secret, redirect_uri = resolve_drive_oauth(session)

    now = utc_now()
    state_hash = hashlib.sha256(state.encode("utf-8")).hexdigest()
    row = session.exec(
        select(BackupOauthState).where(BackupOauthState.state_hash == state_hash)
    ).first()
    if row is None or row.consumed_at is not None or row.expires_at < now:
        raise BackupPermanentError(
            "oauth_state_invalid", "El state OAuth no es válido, ya se usó o expiró."
        )
    row.consumed_at = now
    session.add(row)

    # Intercambio code -> tokens con la lib mantenida de Google (nunca a mano).
    from google_auth_oauthlib.flow import Flow

    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": client_id,
                "client_secret": client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/v2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        },
        scopes=["https://www.googleapis.com/auth/drive.file"],
        redirect_uri=redirect_uri,
    )
    try:
        flow.fetch_token(code=code)
    except Exception as error:  # texto crudo de Google fuera de la base/alerta
        raise BackupPermanentError(
            "oauth_exchange_failed", "Google rechazó el intercambio del código OAuth."
        ) from error
    refresh_token = getattr(flow.credentials, "refresh_token", None)
    if not refresh_token:
        raise BackupPermanentError(
            "oauth_refresh_token_missing",
            "Google no entregó refresh token; reintenta la conexión (prompt=consent).",
        )

    drive = GoogleDriveBackupService(
        refresh_token=refresh_token, client_id=client_id, client_secret=client_secret
    )
    config = get_backup_settings(session, for_update=True)
    folder_id = drive.ensure_folder(config.drive_folder_id)

    config.drive_refresh_token_ciphertext = encrypt_refresh_token(refresh_token)
    config.drive_folder_id = folder_id
    config.drive_status = BackupDriveStatus.ACTIVE
    config.drive_connected_at = now
    config.last_error_code = None
    config.last_error_summary = None
    config.last_error_at = None
    session.add(config)


def disconnect_drive(session: Session, user_id: uuid.UUID) -> BackupSettings:
    """Desconecta Drive: apaga respaldos y olvida token/carpeta. NO borra archivos
    remotos ni el historial."""
    config = get_backup_settings(session, for_update=True)
    config.enabled = False
    config.drive_status = BackupDriveStatus.DISCONNECTED
    config.drive_refresh_token_ciphertext = None
    config.drive_folder_id = None
    config.drive_connected_at = None
    config.last_error_code = None
    config.last_error_summary = None
    config.last_error_at = None
    config.updated_by = user_id
    session.add(config)
    return config


def generate_encryption_key(session: Session, user_id: uuid.UUID) -> str:
    """Genera el par de claves age EN EL SISTEMA, configura el recipient y guarda la
    identidad privada CIFRADA (Fernet). Devuelve la identidad EN CLARO una sola vez,
    para enviarla por correo al administrador — la clave que abre los respaldos no
    debe perderse jamás (requisito explícito del dueño del producto)."""
    from backend.app.services.backup_crypto_service import generate_age_keypair

    recipient, identity = generate_age_keypair()
    config = get_backup_settings(session, for_update=True)
    config.age_recipient = recipient
    config.age_recipient_fingerprint = age_recipient_fingerprint(recipient)
    from backend.app.services.secret_cipher import encrypt_secret

    config.age_identity_ciphertext = encrypt_secret(identity)
    config.updated_by = user_id
    session.add(config)
    return identity


def stored_identity_plain(config: BackupSettings) -> Optional[str]:
    """Identidad privada guardada (si el par lo generó el sistema), descifrada para
    reenviarla por correo. ``None`` si no hay o si no puede descifrarse."""
    if not config.age_identity_ciphertext:
        return None
    from backend.app.services.secret_cipher import decrypt_secret

    return decrypt_secret(config.age_identity_ciphertext)


def backup_settings_email(config: BackupSettings, identity_plain: Optional[str]) -> tuple[str, str]:
    """(asunto, cuerpo) del correo de configuración de respaldos.

    Resume la configuración aplicada y, si el sistema generó la clave de cifrado,
    INCLUYE la identidad privada para que el administrador siempre tenga una copia
    con la que abrir sus respaldos. Es el único lugar (además del momento de
    generación) donde esa clave sale del sistema.
    """
    encryption = "SIN CIFRAR (los respaldos suben como .tar legible)"
    if config.age_recipient:
        origin = "generada por el sistema" if identity_plain else "clave externa del administrador"
        encryption = f"Cifrado con age ({origin}); huella {config.age_recipient_fingerprint}"
    lines = [
        "Se actualizó la configuración de respaldos de Platform Core.",
        "",
        f"- Respaldos habilitados: {'sí' if config.enabled else 'no'}",
        f"- Hora diaria: {config.daily_time.strftime('%H:%M')} ({config.timezone})",
        f"- Prefijo de archivo: {config.filename_prefix}",
        (
            "- Retención: "
            f"{config.retention_daily_count} diarias, "
            f"{config.retention_monthly_count} mensuales, "
            f"{config.retention_yearly_count} anuales"
        ),
        f"- Google Drive: {config.drive_status.value}",
        f"- Cifrado: {encryption}",
    ]
    if config.age_recipient:
        lines += ["", f"Clave PÚBLICA (recipient): {config.age_recipient}"]
    if identity_plain:
        lines += [
            "",
            "CLAVE PRIVADA DE CIFRADO — GUARDA ESTE CORREO:",
            identity_plain,
            "",
            "Esta clave es la ÚNICA forma de abrir los respaldos cifrados. Si se",
            "pierde, los respaldos cifrados no podrán recuperarse. Para restaurar:",
            "descarga el archivo .tar.age de Google Drive y ejecuta",
            "  age --decrypt -i <archivo-con-esta-clave> respaldo.tar.age > respaldo.tar",
            "luego extrae el tar y usa pg_restore con database.dump.",
        ]
    else:
        lines += [
            "",
            "Los respaldos sin cifrar se restauran descargando el .tar de Google",
            "Drive, extrayéndolo y usando pg_restore con database.dump.",
        ]
    return "Platform Core: configuración de respaldos actualizada", "\n".join(lines)


def drive_client_from_config(
    session: Session, config: BackupSettings
) -> GoogleDriveBackupService:
    """Cliente de Drive autenticado con la conexión guardada. Lanza
    ``BackupPermanentError`` si Drive no está conectado/activo."""
    if (
        config.drive_status != BackupDriveStatus.ACTIVE
        or not config.drive_refresh_token_ciphertext
        or not config.drive_folder_id
    ):
        raise BackupPermanentError(
            "drive_not_connected", "Google Drive no está conectado."
        )
    client_id, client_secret, _redirect = resolve_drive_oauth(session)
    return GoogleDriveBackupService(
        refresh_token=decrypt_refresh_token(config.drive_refresh_token_ciphertext),
        client_id=client_id,
        client_secret=client_secret,
    )


def enqueue_manual_run(session: Session) -> BackupRun:
    """Crea la ejecución manual (queued, reclamable de inmediato por el tick)."""
    explorer_status, policy = initial_explorer_status(get_backup_settings(session))
    run = BackupRun(
        status=BackupRunStatus.QUEUED,
        trigger_kind=BackupTriggerKind.MANUAL,
        next_attempt_at=utc_now(),
        explorer_status=explorer_status,
        explorer_policy_version=policy,
    )
    session.add(run)
    return run


# --------------------------------------------------------------------------------
# Tick (la única entrada del worker)
# --------------------------------------------------------------------------------


class BackupService:
    """Orquestador del ciclo de respaldo. Una instancia por proceso worker."""

    def __init__(self, worker_id: Optional[str] = None) -> None:
        self.worker_id = worker_id or f"worker-{uuid.uuid4().hex[:8]}"
        # Alertas operativas creadas durante el tick: al final se patea el despacho
        # de correos UNA vez (post-commit); el worker no tiene los kicks del flujo web.
        self._alerts_pending = False

    def _alert_backup_admins(self, session: Session, *, title: str, body: str) -> None:
        """Alerta ACTIVA a los administradores de respaldos (campana + correo + push).

        SIN commit: viaja en la transacción del evento que la origina. Sin esto, un
        fallo definitivo solo dejaba `last_error` en el panel — silencio operativo.
        """
        from backend.app.security.groups.backups import BackupPermissions
        from backend.app.services.notification_service import notify_users_with_permission

        notify_users_with_permission(
            session,
            permission=BackupPermissions.CONFIGURE.permission,
            title=title,
            body=body,
            link_url="/backups",
        )
        self._alerts_pending = True

    # -- ciclo ------------------------------------------------------------------

    def run_tick(self) -> None:
        """Un ciclo completo: recuperar abandonados, programar vencidos, reclamar y
        ejecutar UNA ejecución. Silencioso cuando no hay trabajo vencido."""
        if not settings.backups_enabled:
            return
        with Session(engine) as session:
            self._recover_expired_leases(session)
            session.commit()

        with Session(engine) as session:
            self._schedule_due_run(session)
            session.commit()

        run_id = self._claim_one()
        try:
            if run_id is not None:
                self._process_claimed(run_id)
        finally:
            # Despacho de correos de las alertas creadas en ESTE tick (post-commit).
            # El worker no tiene los kicks del flujo web; sin esto quedarían pending.
            if self._alerts_pending:
                self._alerts_pending = False
                from backend.app.services.notification_service import (
                    kick_notification_dispatch,
                )

                kick_notification_dispatch()

    # -- fases ------------------------------------------------------------------

    def _recover_expired_leases(self, session: Session) -> None:
        now = utc_now()
        expired = session.exec(
            select(BackupRun)
            .where(
                BackupRun.status == BackupRunStatus.RUNNING,
                BackupRun.lease_expires_at.is_not(None),  # type: ignore[union-attr]
                BackupRun.lease_expires_at < now,
            )
            .with_for_update(skip_locked=True)
        ).all()
        for run in expired:
            if run.attempt_count >= max_attempts_effective(session):
                self._finish_failed(
                    session,
                    run,
                    code="worker_lost",
                    summary="El proceso de respaldo se interrumpió y agotó sus intentos.",
                )
            else:
                run.status = BackupRunStatus.RETRYING
                run.next_attempt_at = now
                run.lease_expires_at = None
                session.add(run)

    def _schedule_due_run(self, session: Session) -> None:
        """Crea la ejecución programada vencida y avanza ``next_run_at`` en la misma
        transacción (con la fila de settings bloqueada)."""
        now = utc_now()
        config = get_backup_settings(session, for_update=True)
        if not config.enabled or config.next_run_at is None or config.next_run_at > now:
            return
        scheduled_for = config.next_run_at
        # Avanza SIEMPRE el horario (una ventana = una decisión), incluso si la ventana
        # se salta por Drive desconectado: sin esto, el tick re-crearía trabajo cada
        # minuto para la misma ventana vencida.
        config.next_run_at = calculate_next_run_at(now, config.timezone, config.daily_time)
        session.add(config)

        if config.drive_status != BackupDriveStatus.ACTIVE:
            # Ventana saltada de forma visible: el historial registra el hueco y la
            # alerta persistente ya explica el motivo (needs_reauth/disconnected).
            session.add(
                BackupRun(
                    status=BackupRunStatus.SKIPPED,
                    trigger_kind=BackupTriggerKind.SCHEDULED,
                    scheduled_for=scheduled_for,
                    finished_at=now,
                    error_code="drive_not_active",
                    error_summary="Ventana saltada: Google Drive no está conectado.",
                )
            )
            return

        explorer_status, policy = initial_explorer_status(config)
        session.add(
            BackupRun(
                status=BackupRunStatus.QUEUED,
                trigger_kind=BackupTriggerKind.SCHEDULED,
                scheduled_for=scheduled_for,
                next_attempt_at=now,
                explorer_status=explorer_status,
                explorer_policy_version=policy,
            )
        )

    def _claim_one(self) -> Optional[uuid.UUID]:
        """Reclama UNA ejecución vencida (queued/retrying) con SKIP LOCKED + lease."""
        now = utc_now()
        with Session(engine) as session:
            run = session.exec(
                select(BackupRun)
                .where(
                    BackupRun.status.in_(  # type: ignore[union-attr]
                        [BackupRunStatus.QUEUED, BackupRunStatus.RETRYING]
                    ),
                    BackupRun.next_attempt_at.is_not(None),  # type: ignore[union-attr]
                    BackupRun.next_attempt_at <= now,
                )
                .order_by(BackupRun.next_attempt_at)  # type: ignore[arg-type]
                .limit(1)
                .with_for_update(skip_locked=True)
            ).first()
            if run is None:
                return None
            run.status = BackupRunStatus.RUNNING
            run.attempt_count += 1
            if run.started_at is None:
                run.started_at = now
            run.lease_expires_at = now + timedelta(minutes=run_lease_minutes_effective(session))
            run.next_attempt_at = None
            session.add(run)
            session.commit()
            return run.id

    def _process_claimed(self, run_id: uuid.UUID) -> None:
        """Ejecuta el respaldo del run reclamado y registra el desenlace."""
        try:
            self._execute_run(run_id)
        except (BackupTemporaryError, DriveTemporaryError) as error:
            self._handle_temporary_failure(run_id, code=error.code, summary=error.summary)
        except DriveReauthError as error:
            self._handle_reauth_failure(run_id, code=error.code, summary=error.summary)
        except (BackupPermanentError, BackupCryptoError) as error:
            self._handle_permanent_failure(run_id, code=error.code, summary=error.summary)
        except Exception:
            # Inesperado: resumen seguro y reintento (el detalle vive sólo en logs).
            logger.exception("backup_run_unexpected_error run_id=%s", run_id)
            self._handle_temporary_failure(
                run_id,
                code="unexpected_error",
                summary="Error inesperado durante el respaldo.",
            )

    # -- ejecución --------------------------------------------------------------

    def _execute_run(self, run_id: uuid.UUID) -> None:
        with Session(engine) as session:
            run = session.get(BackupRun, run_id)
            config = get_backup_settings(session)
            if run is None:
                return
            missing = missing_configuration(config)
            if missing:
                raise BackupPermanentError(
                    "configuration_incomplete",
                    f"Configuración incompleta: {', '.join(sorted(missing))}.",
                )
            assert config.drive_folder_id is not None
            # Cifrado OPCIONAL (decisión del dueño del producto): con recipient se
            # cifra con age; sin recipient el respaldo sube SIN cifrar (.tar).
            recipient = config.age_recipient
            folder_id = config.drive_folder_id
            token_ciphertext = config.drive_refresh_token_ciphertext
            timezone_name = config.timezone
            prefix = config.filename_prefix
            retention = (
                config.retention_daily_count,
                config.retention_monthly_count,
                config.retention_yearly_count,
            )
        if token_ciphertext is None:
            raise BackupPermanentError(
                "drive_token_missing", "No hay token de Drive guardado; reconecta Google Drive."
            )

        with Session(engine) as oauth_session:
            client_id, client_secret, _redirect = resolve_drive_oauth(oauth_session)
        drive = GoogleDriveBackupService(
            refresh_token=decrypt_refresh_token(token_ciphertext),
            client_id=client_id,
            client_secret=client_secret,
        )

        now = utc_now()
        file_name = build_backup_filename(prefix, now, run_id, encrypted=recipient is not None)

        # Reconciliación idempotente: si un intento anterior SÍ subió el archivo pero
        # la respuesta se perdió, no se duplica la carga.
        with Session(engine) as session:
            run = session.get(BackupRun, run_id)
            assert run is not None
            existing_sha = run.ciphertext_sha256
        remote = drive.find_backup_by_run_id(folder_id, str(run_id), artifact_kind="restore")
        if remote is not None and existing_sha and remote.sha256 == existing_sha:
            self._finish_succeeded(
                run_id,
                file_name=remote.name or file_name,
                file_size_bytes=remote.size_bytes,
                ciphertext_sha256=existing_sha,
                drive_file_id=remote.file_id,
                drive_folder_id=folder_id,
                recipient=recipient,
                timezone_name=timezone_name,
                retention=retention,
                drive=drive,
            )
            # Restore reconciliado sin regenerar nada: un explorer aún "building" de
            # este run no puede construirse ya del MISMO instante → failed honesto.
            self._mark_explorer_failed(
                run_id,
                code="explorer_snapshot_lost",
                summary="El respaldo se reconcilió sin regenerar; no hay snapshot para el explorador.",
            )
            return

        temp_root = Path(settings.backup_temp_dir)
        temp_root.mkdir(parents=True, exist_ok=True)
        workdir = Path(tempfile.mkdtemp(prefix="run-", dir=temp_root))
        explorer_sqlite: Optional[Path] = None
        try:
            dump_path = workdir / "database.dump"
            # Snapshot COMPARTIDO: el dump restaurable y el explorer SQLite leen el
            # MISMO instante de la base (pg_dump --snapshot + SET TRANSACTION
            # SNAPSHOT). El snapshot se mantiene abierto sólo lo que tardan ambos.
            with exported_read_snapshot() as snapshot_id:
                self._pg_dump(dump_path, snapshot_id)
                self._pg_restore_list(dump_path)
                explorer_sqlite = self._build_explorer(run_id, workdir, snapshot_id)

            manifest_path = workdir / "manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "format_version": MANIFEST_FORMAT_VERSION,
                        "backup_run_id": str(run_id),
                        "created_at": now.replace(tzinfo=dt_timezone.utc).isoformat(),
                        "application_version": settings.project_name,
                        "database_archive_name": "database.dump",
                        "plaintext_sha256": sha256_of_file(dump_path),
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )

            tar_path = workdir / "backup.tar"
            with tarfile.open(tar_path, "w") as archive:
                archive.add(dump_path, arcname="database.dump")
                archive.add(manifest_path, arcname="manifest.json")

            if recipient is not None:
                upload_path = workdir / file_name
                encrypt_file_with_age(tar_path, upload_path, recipient)
            else:
                upload_path = tar_path
            ciphertext_sha256 = sha256_of_file(upload_path)
            file_size = upload_path.stat().st_size

            # El checksum se persiste ANTES de subir: si la subida se corta tras
            # completarse en Google, el siguiente intento reconcilia por run_id+sha.
            with Session(engine) as session:
                run = session.get(BackupRun, run_id)
                assert run is not None
                run.ciphertext_sha256 = ciphertext_sha256
                run.file_name = file_name
                run.file_size_bytes = file_size
                run.encryption_fingerprint = (
                    age_recipient_fingerprint(recipient) if recipient is not None else None
                )
                session.add(run)
                session.commit()

            drive_file_id = drive.upload_backup(
                folder_id=folder_id,
                file_path=upload_path,
                file_name=file_name,
                run_id=str(run_id),
                sha256=ciphertext_sha256,
                artifact_kind="restore",
            )

            self._finish_succeeded(
                run_id,
                file_name=file_name,
                file_size_bytes=file_size,
                ciphertext_sha256=ciphertext_sha256,
                drive_file_id=drive_file_id,
                drive_folder_id=folder_id,
                recipient=recipient,
                timezone_name=timezone_name,
                retention=retention,
                drive=drive,
            )

            # El artefacto de EXPLORACIÓN se procesa DESPUÉS del éxito del restore y
            # sus fallos jamás lo invalidan (estado y errores propios en explorer_*).
            if explorer_sqlite is not None:
                self._process_explorer(
                    run_id,
                    sqlite_path=explorer_sqlite,
                    workdir=workdir,
                    recipient=recipient,
                    folder_id=folder_id,
                    prefix=prefix,
                    now_utc=now,
                    drive=drive,
                )
        finally:
            shutil.rmtree(workdir, ignore_errors=True)

    def _pg_dump(self, output_path: Path, snapshot_id: Optional[str] = None) -> None:
        """pg_dump -Fc de UNA base (sin roles/tablespaces globales), credenciales sólo
        por env del subprocess (nunca argumentos). Con ``snapshot_id`` el dump lee el
        snapshot exportado (mismo instante que el explorer)."""
        env = {
            "PGHOST": settings.postgres_server,
            "PGPORT": str(settings.postgres_port),
            "PGUSER": settings.postgres_user,
            "PGPASSWORD": settings.postgres_password,
            "PGDATABASE": settings.postgres_db,
        }
        command = [
            "pg_dump",
            "--format=custom",
            "--no-owner",
            "--no-acl",
            "--file",
            str(output_path),
        ]
        if snapshot_id is not None:
            command.append(f"--snapshot={snapshot_id}")
        try:
            result = subprocess.run(
                command,
                shell=False,
                check=False,
                capture_output=True,
                timeout=_PG_DUMP_TIMEOUT_SECONDS,
                env=env,
            )
        except FileNotFoundError as error:
            raise BackupPermanentError(
                "pg_dump_missing", "pg_dump no está instalado en la imagen."
            ) from error
        except subprocess.TimeoutExpired as error:
            raise BackupTemporaryError(
                "pg_dump_timeout", "pg_dump excedió el tiempo máximo."
            ) from error
        if result.returncode != 0:
            # stderr puede nombrar host/base: sólo a logs internos, nunca a la fila.
            logger.error("pg_dump_failed rc=%s", result.returncode)
            raise BackupTemporaryError("pg_dump_failed", "pg_dump terminó con error.")

    def _pg_restore_list(self, dump_path: Path) -> None:
        """Valida que el archive es legible ANTES de cifrar (pg_restore --list)."""
        try:
            result = subprocess.run(
                ["pg_restore", "--list", str(dump_path)],
                shell=False,
                check=False,
                capture_output=True,
                timeout=_PG_RESTORE_LIST_TIMEOUT_SECONDS,
            )
        except FileNotFoundError as error:
            raise BackupPermanentError(
                "pg_restore_missing", "pg_restore no está instalado en la imagen."
            ) from error
        except subprocess.TimeoutExpired as error:
            raise BackupTemporaryError(
                "pg_restore_list_timeout", "La verificación del respaldo excedió el tiempo."
            ) from error
        if result.returncode != 0 or not result.stdout.strip():
            raise BackupTemporaryError(
                "dump_unreadable", "El archivo generado por pg_dump no es legible."
            )

    # -- artefacto de exploración ---------------------------------------------------

    def _build_explorer(
        self, run_id: uuid.UUID, workdir: Path, snapshot_id: str
    ) -> Optional[Path]:
        """Construye el SQLite de exploración DENTRO del snapshot compartido. Un
        fallo aquí marca explorer_status=failed y devuelve None: el respaldo
        restaurable continúa intacto."""
        # El gate real es la política (explorer_status del run, decidido al crear);
        # el flag de la fila pudo cambiar después y el run manda.
        with Session(engine) as session:
            run = session.get(BackupRun, run_id)
            if run is None or run.explorer_status != BackupExplorerStatus.BUILDING:
                return None
        from backend.app.services.explorer_snapshot_service import (
            ExplorerSnapshotError,
            explorer_snapshot_service,
        )

        started = datetime.now(dt_timezone.utc)
        logger.info("backup.explorer.started backup_run_id=%s", run_id)
        sqlite_path = workdir / "explorer.sqlite"
        try:
            result = explorer_snapshot_service.build(
                source_dsn=source_postgres_dsn(),
                snapshot_id=snapshot_id,
                output_path=sqlite_path,
                backup_run_id=run_id,
            )
        except ExplorerSnapshotError as error:
            self._mark_explorer_failed(run_id, code=error.code, summary=error.summary)
            return None
        except Exception:
            logger.exception("backup.explorer.failed backup_run_id=%s", run_id)
            self._mark_explorer_failed(
                run_id,
                code="explorer_unexpected_error",
                summary="Error inesperado al construir el artefacto de exploración.",
            )
            return None
        duration_ms = int((datetime.now(dt_timezone.utc) - started).total_seconds() * 1000)
        logger.info(
            "backup.explorer.built backup_run_id=%s table_count=%s row_count=%s duration_ms=%s",
            run_id,
            result.table_count,
            result.row_count,
            duration_ms,
        )
        return sqlite_path

    def _process_explorer(
        self,
        run_id: uuid.UUID,
        *,
        sqlite_path: Path,
        workdir: Path,
        recipient: Optional[str],
        folder_id: str,
        prefix: str,
        now_utc: datetime,
        drive: GoogleDriveBackupService,
    ) -> None:
        """Cifra (si hay recipient) y sube el explorer, con hasta 3 intentos para
        fallos TEMPORALES de la subida dentro de esta misma ejecución. Reauth marca
        needs_reauth (alerta persistente) sin reintentos; nada de esto toca el
        estado succeeded del restore."""
        try:
            file_name = build_explorer_filename(
                prefix, now_utc, run_id, encrypted=recipient is not None
            )
            if recipient is not None:
                upload_path = workdir / file_name
                encrypt_file_with_age(sqlite_path, upload_path, recipient)
                logger.info("backup.explorer.encrypted backup_run_id=%s", run_id)
            else:
                upload_path = sqlite_path
            sha256 = sha256_of_file(upload_path)
            size = upload_path.stat().st_size

            # Idempotencia: si un intento previo YA subió este explorer, se adopta.
            remote = drive.find_backup_by_run_id(
                folder_id, str(run_id), artifact_kind="explorer"
            )
            if remote is not None and remote.sha256 == sha256:
                drive_file_id = remote.file_id
            else:
                drive_file_id = self._upload_explorer_with_retries(
                    drive=drive,
                    folder_id=folder_id,
                    upload_path=upload_path,
                    file_name=file_name,
                    run_id=run_id,
                    sha256=sha256,
                )
        except DriveReauthError as error:
            self._mark_explorer_failed(
                run_id,
                code="google_drive_reauth_required",
                summary="La cuenta de Google Drive requiere reconexión.",
            )
            with Session(engine) as session:
                config = get_backup_settings(session, for_update=True)
                if config.drive_status != BackupDriveStatus.NEEDS_REAUTH:
                    self._alert_backup_admins(
                        session,
                        title="Google Drive requiere reconexión",
                        body=(
                            "Los respaldos quedaron DETENIDOS: la conexión con Google "
                            "Drive dejó de servir y hay que reconectarla desde el panel."
                        ),
                    )
                config.drive_status = BackupDriveStatus.NEEDS_REAUTH
                config.last_error_code = error.code
                config.last_error_summary = error.summary
                config.last_error_at = utc_now()
                session.add(config)
                session.commit()
            return
        except (DriveTemporaryError, BackupCryptoError) as error:
            self._mark_explorer_failed(run_id, code=error.code, summary=error.summary)
            return
        except Exception:
            logger.exception("backup.explorer.failed backup_run_id=%s", run_id)
            self._mark_explorer_failed(
                run_id,
                code="explorer_unexpected_error",
                summary="Error inesperado al subir el artefacto de exploración.",
            )
            return

        with Session(engine) as session:
            run = session.get(BackupRun, run_id)
            if run is None:
                return
            run.explorer_status = BackupExplorerStatus.READY
            run.explorer_file_name = file_name
            run.explorer_file_size_bytes = size
            run.explorer_ciphertext_sha256 = sha256
            run.explorer_drive_file_id = drive_file_id
            run.explorer_created_at = utc_now()
            run.explorer_error_code = None
            run.explorer_error_summary = None
            session.add(run)
            session.commit()
        logger.info(
            "backup.explorer.uploaded backup_run_id=%s file_size_bytes=%s", run_id, size
        )

    def _upload_explorer_with_retries(
        self,
        *,
        drive: GoogleDriveBackupService,
        folder_id: str,
        upload_path: Path,
        file_name: str,
        run_id: uuid.UUID,
        sha256: str,
    ) -> str:
        """Hasta 3 intentos DENTRO de la misma ejecución para fallos temporales de la
        subida (no se re-corre el respaldo ni se regenera el explorer)."""
        import time as time_module

        last_error: Optional[DriveTemporaryError] = None
        for attempt in range(3):
            try:
                return drive.upload_backup(
                    folder_id=folder_id,
                    file_path=upload_path,
                    file_name=file_name,
                    run_id=str(run_id),
                    sha256=sha256,
                    artifact_kind="explorer",
                )
            except DriveTemporaryError as error:
                last_error = error
                if attempt < 2:
                    time_module.sleep(2 * (attempt + 1))
        assert last_error is not None
        raise last_error

    def _mark_explorer_failed(self, run_id: uuid.UUID, *, code: str, summary: str) -> None:
        with Session(engine) as session:
            run = session.get(BackupRun, run_id)
            if run is None:
                return
            run.explorer_status = BackupExplorerStatus.FAILED
            run.explorer_error_code = code
            run.explorer_error_summary = summary
            session.add(run)
            session.commit()
        logger.info("backup.explorer.failed backup_run_id=%s error_code=%s", run_id, code)

    # -- desenlaces ---------------------------------------------------------------

    def _finish_succeeded(
        self,
        run_id: uuid.UUID,
        *,
        file_name: str,
        file_size_bytes: Optional[int],
        ciphertext_sha256: str,
        drive_file_id: str,
        drive_folder_id: str,
        recipient: Optional[str],
        timezone_name: str,
        retention: tuple[int, int, int],
        drive: GoogleDriveBackupService,
    ) -> None:
        now = utc_now()
        zone = ZoneInfo(timezone_name)
        finished_local = now.replace(tzinfo=dt_timezone.utc).astimezone(zone)
        with Session(engine) as session:
            # Roles en fechas LOCALES: primer éxito del mes/año local.
            month_taken = self._role_taken(session, "monthly", finished_local, zone)
            year_taken = self._role_taken(session, "yearly", finished_local, zone)
            roles = compute_retention_roles(month_taken=month_taken, year_taken=year_taken)

            run = session.get(BackupRun, run_id)
            assert run is not None
            run.status = BackupRunStatus.SUCCEEDED
            run.finished_at = now
            run.lease_expires_at = None
            run.next_attempt_at = None
            run.file_name = file_name
            run.file_size_bytes = file_size_bytes
            run.ciphertext_sha256 = ciphertext_sha256
            run.drive_file_id = drive_file_id
            run.drive_folder_id = drive_folder_id
            run.encryption_fingerprint = (
                age_recipient_fingerprint(recipient) if recipient is not None else None
            )
            run.retention_roles = roles
            run.error_code = None
            run.error_summary = None
            session.add(run)

            # Éxito = alerta despejada.
            config = get_backup_settings(session, for_update=True)
            config.last_error_code = None
            config.last_error_summary = None
            config.last_error_at = None
            session.add(config)
            session.commit()

        self._apply_retention(retention, drive)

    def _role_taken(
        self, session: Session, role: str, finished_local: datetime, zone: ZoneInfo
    ) -> bool:
        """¿Ya existe un respaldo exitoso vigente con este rol en el mismo mes/año
        LOCAL? (Acotado en Python: los exitosos vigentes son pocos por retención.)"""
        rows = session.exec(
            select(BackupRun).where(
                BackupRun.status == BackupRunStatus.SUCCEEDED,
                BackupRun.finished_at.is_not(None),  # type: ignore[union-attr]
            )
        ).all()
        for row in rows:
            if role not in (row.retention_roles or []):
                continue
            assert row.finished_at is not None
            row_local = row.finished_at.replace(tzinfo=dt_timezone.utc).astimezone(zone)
            if role == "monthly" and (row_local.year, row_local.month) == (
                finished_local.year,
                finished_local.month,
            ):
                return True
            if role == "yearly" and row_local.year == finished_local.year:
                return True
        return False

    def _apply_retention(
        self, retention: tuple[int, int, int], drive: GoogleDriveBackupService
    ) -> None:
        """Rota archivos remotos tras un éxito. Un fallo aquí NO revierte el éxito:
        se registra y la próxima rotación lo reintenta."""
        daily_count, monthly_count, yearly_count = retention
        with Session(engine) as session:
            rows = session.exec(
                select(BackupRun).where(
                    BackupRun.status == BackupRunStatus.SUCCEEDED,
                    BackupRun.drive_file_id.is_not(None),  # type: ignore[union-attr]
                    BackupRun.finished_at.is_not(None),  # type: ignore[union-attr]
                )
            ).all()
            candidates = [
                RetentionCandidate(
                    run_id=row.id,
                    finished_at=row.finished_at,  # type: ignore[arg-type]
                    roles=tuple(row.retention_roles or []),
                )
                for row in rows
            ]
        to_prune = plan_retention_pruning(
            candidates,
            daily_count=daily_count,
            monthly_count=monthly_count,
            yearly_count=yearly_count,
        )
        for prune_id in to_prune:
            try:
                with Session(engine) as session:
                    run = session.get(BackupRun, prune_id)
                    if run is None or run.drive_file_id is None:
                        continue
                    # PAREJA: primero el explorer; si su borrado falla, el restore se
                    # conserva y la siguiente rotación reintenta (pruned exige ambos
                    # artefactos fuera).
                    if run.explorer_drive_file_id is not None:
                        drive.delete_backup(run.explorer_drive_file_id)
                        run.explorer_drive_file_id = None
                        logger.info("backup.explorer.pruned backup_run_id=%s", prune_id)
                    drive.delete_backup(run.drive_file_id)
                    run.status = BackupRunStatus.PRUNED
                    run.pruned_at = utc_now()
                    session.add(run)
                    session.commit()
            except (DriveTemporaryError, DriveReauthError):
                # No condena el respaldo recién exitoso; la siguiente rotación reintenta.
                logger.warning("backup_retention_prune_failed run_id=%s", prune_id)

    def _handle_temporary_failure(self, run_id: uuid.UUID, *, code: str, summary: str) -> None:
        with Session(engine) as session:
            run = session.get(BackupRun, run_id)
            if run is None:
                return
            delay = next_retry_delay_minutes(run.attempt_count, max_attempts_effective(session))
            if delay is None:
                self._finish_failed(session, run, code=code, summary=summary)
            else:
                run.status = BackupRunStatus.RETRYING
                run.next_attempt_at = utc_now() + timedelta(minutes=delay)
                run.lease_expires_at = None
                run.error_code = code
                run.error_summary = summary
                session.add(run)
            session.commit()

    def _handle_permanent_failure(self, run_id: uuid.UUID, *, code: str, summary: str) -> None:
        with Session(engine) as session:
            run = session.get(BackupRun, run_id)
            if run is None:
                return
            self._finish_failed(session, run, code=code, summary=summary)
            session.commit()

    def _handle_reauth_failure(self, run_id: uuid.UUID, *, code: str, summary: str) -> None:
        """Drive exige reconexión: falla terminal + reintentos DETENIDOS (las próximas
        ventanas se saltan hasta que el administrador reconecte)."""
        with Session(engine) as session:
            run = session.get(BackupRun, run_id)
            if run is not None:
                self._finish_failed(session, run, code=code, summary=summary)
            config = get_backup_settings(session, for_update=True)
            # Alerta específica SOLO al transicionar (no se repite en cada tick).
            if config.drive_status != BackupDriveStatus.NEEDS_REAUTH:
                self._alert_backup_admins(
                    session,
                    title="Google Drive requiere reconexión",
                    body=(
                        "Los respaldos quedaron DETENIDOS: la conexión con Google "
                        "Drive dejó de servir y hay que reconectarla desde el panel."
                    ),
                )
            config.drive_status = BackupDriveStatus.NEEDS_REAUTH
            session.add(config)
            session.commit()

    def _finish_failed(
        self, session: Session, run: BackupRun, *, code: str, summary: str
    ) -> None:
        """Marca la ejecución failed y deja la ALERTA PERSISTENTE en settings."""
        run.status = BackupRunStatus.FAILED
        run.finished_at = utc_now()
        run.lease_expires_at = None
        run.next_attempt_at = None
        run.error_code = code
        run.error_summary = summary
        session.add(run)

        config = get_backup_settings(session, for_update=True)
        config.last_error_code = code
        config.last_error_summary = summary
        config.last_error_at = utc_now()
        session.add(config)

        self._alert_backup_admins(
            session,
            title="Respaldo fallido",
            body=(
                f"El respaldo agotó sus intentos y quedó FALLIDO ({code}): {summary} "
                "Revisa la configuración de respaldos."
            ),
        )


# Instancia por proceso (la usa la tarea Taskiq).
backup_service = BackupService()
