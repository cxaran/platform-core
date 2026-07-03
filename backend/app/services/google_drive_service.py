"""Adaptador ÚNICO de Google Drive para respaldos (scope drive.file).

Nadie más llama a googleapiclient: ni el router, ni la tarea, ni backup_service tocan
la API de Google directamente. El scope ``drive.file`` sólo da acceso a archivos que la
propia app crea — nunca a todo el Drive del administrador. Se usa una carpeta VISIBLE
creada por la app ("Platform Core Backups"), no ``appDataFolder``.

Errores: se clasifican aquí en dos excepciones SEGURAS (sin texto crudo de Google, sin
tokens): ``DriveTemporaryError`` (red/5xx/429: reintentable) y ``DriveReauthError``
(credencial inválida/revocada: detener reintentos hasta reconectar).
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

BACKUP_FOLDER_NAME = "Platform Core Backups"
DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file"

# appProperties con las que se reconcilian subidas tras un timeout (idempotencia) y
# se distingue el tipo de artefacto de un mismo respaldo (restore vs explorer).
_PROP_RUN_ID = "platform_core_backup_run_id"
_PROP_SHA256 = "platform_core_sha256"
_PROP_ARTIFACT_KIND = "platform_core_artifact_kind"


class DriveTemporaryError(Exception):
    """Fallo temporal (red, 5xx, 429): el run reintenta con backoff."""

    def __init__(self, code: str, summary: str) -> None:
        super().__init__(summary)
        self.code = code
        self.summary = summary


class DriveReauthError(Exception):
    """La credencial dejó de servir (revocada/expirada): reintentos DETENIDOS hasta
    que el administrador reconecte Drive."""

    def __init__(self, code: str, summary: str) -> None:
        super().__init__(summary)
        self.code = code
        self.summary = summary


@dataclass(frozen=True)
class RemoteBackupFile:
    """Proyección mínima de un archivo remoto (para reconciliación y retención)."""

    file_id: str
    name: str
    size_bytes: Optional[int]
    sha256: Optional[str]
    run_id: Optional[str]
    artifact_kind: Optional[str]
    created_time: Optional[str] = None


def _classify_http_error(error: Exception) -> Exception:
    """Traduce errores del cliente de Google a nuestras excepciones seguras."""
    from google.auth.exceptions import RefreshError  # import perezoso (ver abajo)
    from googleapiclient.errors import HttpError

    if isinstance(error, RefreshError):
        return DriveReauthError(
            "drive_needs_reauth",
            "Google rechazó la credencial guardada; reconecta Google Drive.",
        )
    if isinstance(error, HttpError):
        status = error.resp.status if error.resp is not None else None
        if status in (401, 403):
            # 403 también cubre insufficientPermissions/appNotAuthorized: requiere
            # intervención del administrador, no reintento ciego.
            return DriveReauthError(
                "drive_needs_reauth",
                "Google Drive rechazó el acceso; reconecta Google Drive.",
            )
        if status == 429 or (status is not None and status >= 500):
            return DriveTemporaryError(
                "drive_unavailable", f"Google Drive no disponible (HTTP {status})."
            )
        return DriveTemporaryError(
            "drive_request_failed", f"La petición a Google Drive falló (HTTP {status})."
        )
    return DriveTemporaryError(
        "drive_network_error", "No se pudo contactar a Google Drive."
    )


class GoogleDriveBackupService:
    """Cliente pequeño de Drive autenticado con el refresh token de la conexión.

    Los imports de googleapiclient son PEREZOSOS (dentro de métodos): importar el
    módulo no exige tener las libs cargadas en procesos que no respaldan, y los tests
    unitarios pueden sustituir ``_files()`` sin red.
    """

    def __init__(
        self,
        *,
        refresh_token: str,
        client_id: str,
        client_secret: str,
    ) -> None:
        self._refresh_token = refresh_token
        self._client_id = client_id
        self._client_secret = client_secret
        self._service: Any = None

    def _drive(self) -> Any:
        if self._service is None:
            from google.oauth2.credentials import Credentials
            from googleapiclient.discovery import build

            credentials = Credentials(
                token=None,
                refresh_token=self._refresh_token,
                token_uri="https://oauth2.googleapis.com/token",
                client_id=self._client_id,
                client_secret=self._client_secret,
                scopes=[DRIVE_SCOPE],
            )
            # cache_discovery=False: sin caché en disco (imagen de solo lectura).
            self._service = build(
                "drive", "v3", credentials=credentials, cache_discovery=False
            )
        return self._service

    def _files(self) -> Any:
        return self._drive().files()

    # -- Carpeta ---------------------------------------------------------------

    def create_folder(self) -> str:
        """Crea la carpeta visible de respaldos y devuelve su id."""
        try:
            created = (
                self._files()
                .create(
                    body={
                        "name": BACKUP_FOLDER_NAME,
                        "mimeType": "application/vnd.google-apps.folder",
                    },
                    fields="id",
                )
                .execute()
            )
        except Exception as error:  # clasificado: nunca burbujea texto crudo
            raise _classify_http_error(error) from error
        return str(created["id"])

    def validate_folder(self, folder_id: str) -> bool:
        """¿La carpeta sigue existiendo, accesible y fuera de la papelera?"""
        try:
            found = (
                self._files()
                .get(fileId=folder_id, fields="id, trashed, mimeType")
                .execute()
            )
        except Exception as error:
            classified = _classify_http_error(error)
            if isinstance(classified, DriveReauthError):
                raise classified from error
            # 404/no accesible: no es reauth; simplemente ya no sirve esa carpeta.
            return False
        return (
            not bool(found.get("trashed"))
            and found.get("mimeType") == "application/vnd.google-apps.folder"
        )

    def ensure_folder(self, folder_id: Optional[str]) -> str:
        """Valida la carpeta guardada o crea una nueva (reconexión)."""
        if folder_id and self.validate_folder(folder_id):
            return folder_id
        return self.create_folder()

    # -- Archivos ----------------------------------------------------------------

    def find_backup_by_run_id(
        self, folder_id: str, run_id: str, artifact_kind: str = "restore"
    ) -> Optional[RemoteBackupFile]:
        """Busca en la carpeta el artefacto YA subido de este run y tipo
        (idempotencia). Los archivos anteriores a la distinción de tipos no llevan
        ``artifact_kind``: cuentan como ``restore`` (compatibilidad)."""
        query = (
            f"'{folder_id}' in parents and trashed = false "
            f"and appProperties has {{ key='{_PROP_RUN_ID}' and value='{run_id}' }}"
        )
        try:
            response = (
                self._files()
                .list(
                    q=query,
                    fields="files(id, name, size, appProperties)",
                    pageSize=10,
                )
                .execute()
            )
        except Exception as error:
            raise _classify_http_error(error) from error
        for entry in response.get("files", []):
            properties = entry.get("appProperties") or {}
            kind = properties.get(_PROP_ARTIFACT_KIND) or "restore"
            if kind != artifact_kind:
                continue
            size_raw = entry.get("size")
            return RemoteBackupFile(
                file_id=str(entry["id"]),
                name=str(entry.get("name", "")),
                size_bytes=int(size_raw) if size_raw is not None else None,
                sha256=properties.get(_PROP_SHA256),
                run_id=properties.get(_PROP_RUN_ID),
                artifact_kind=kind,
            )
        return None

    def upload_backup(
        self,
        *,
        folder_id: str,
        file_path: Path,
        file_name: str,
        run_id: str,
        sha256: str,
        artifact_kind: str = "restore",
    ) -> str:
        """Sube el archivo (resumable) y devuelve el id remoto. ``artifact_kind``
        distingue el respaldo restaurable del artefacto de exploración."""
        from googleapiclient.http import MediaFileUpload

        media = MediaFileUpload(
            str(file_path), mimetype="application/octet-stream", resumable=True
        )
        try:
            created = (
                self._files()
                .create(
                    body={
                        "name": file_name,
                        "parents": [folder_id],
                        "appProperties": {
                            _PROP_RUN_ID: run_id,
                            _PROP_SHA256: sha256,
                            _PROP_ARTIFACT_KIND: artifact_kind,
                        },
                    },
                    media_body=media,
                    fields="id",
                )
                .execute()
            )
        except Exception as error:
            raise _classify_http_error(error) from error
        return str(created["id"])

    def list_backups(self, folder_id: str) -> list[RemoteBackupFile]:
        """Lista los ARCHIVOS reales de la carpeta de respaldos (más reciente
        primero), con nombre, tamaño, fecha y tipo de artefacto. Pagina hasta
        agotar (la retención acota la carpeta a decenas de archivos)."""
        files: list[RemoteBackupFile] = []
        page_token: Optional[str] = None
        try:
            while True:
                response = (
                    self._files()
                    .list(
                        q=f"'{folder_id}' in parents and trashed = false",
                        fields="nextPageToken, files(id, name, size, createdTime, appProperties)",
                        orderBy="createdTime desc",
                        pageSize=100,
                        pageToken=page_token,
                    )
                    .execute()
                )
                for entry in response.get("files", []):
                    properties = entry.get("appProperties") or {}
                    size_raw = entry.get("size")
                    files.append(
                        RemoteBackupFile(
                            file_id=str(entry["id"]),
                            name=str(entry.get("name", "")),
                            size_bytes=int(size_raw) if size_raw is not None else None,
                            sha256=properties.get(_PROP_SHA256),
                            run_id=properties.get(_PROP_RUN_ID),
                            artifact_kind=properties.get(_PROP_ARTIFACT_KIND) or "restore",
                            created_time=entry.get("createdTime"),
                        )
                    )
                page_token = response.get("nextPageToken")
                if not page_token or len(files) >= 1000:
                    break
        except Exception as error:
            raise _classify_http_error(error) from error
        return files

    def get_backup_file(
        self, file_id: str
    ) -> Optional[tuple[RemoteBackupFile, list[str]]]:
        """Metadata de UN archivo junto con sus carpetas PADRE (el caller valida que
        pertenezca a la carpeta de respaldos antes de servirlo). ``None`` si no
        existe, está en la papelera o no es accesible."""
        from googleapiclient.errors import HttpError

        try:
            entry = (
                self._files()
                .get(
                    fileId=file_id,
                    fields="id, name, size, createdTime, appProperties, parents, trashed",
                )
                .execute()
            )
        except HttpError as error:
            if error.resp is not None and error.resp.status == 404:
                return None
            raise _classify_http_error(error) from error
        except Exception as error:
            raise _classify_http_error(error) from error
        if entry.get("trashed"):
            return None
        properties = entry.get("appProperties") or {}
        size_raw = entry.get("size")
        remote = RemoteBackupFile(
            file_id=str(entry["id"]),
            name=str(entry.get("name", "")),
            size_bytes=int(size_raw) if size_raw is not None else None,
            sha256=properties.get(_PROP_SHA256),
            run_id=properties.get(_PROP_RUN_ID),
            artifact_kind=properties.get(_PROP_ARTIFACT_KIND) or "restore",
            created_time=entry.get("createdTime"),
        )
        return remote, list(entry.get("parents") or [])

    def download_chunks(self, file_id: str, chunk_size: int = 8 * 1024 * 1024):
        """Descarga el archivo por CHUNKS (generator de bytes) con la carga
        reanudable del cliente de Google — apto para respaldos grandes sin cargar
        todo en memoria."""
        import io

        from googleapiclient.http import MediaIoBaseDownload

        request = self._files().get_media(fileId=file_id)
        buffer = io.BytesIO()
        downloader = MediaIoBaseDownload(buffer, request, chunksize=chunk_size)
        done = False
        try:
            while not done:
                _status, done = downloader.next_chunk()
                data = buffer.getvalue()
                if data:
                    yield data
                buffer.seek(0)
                buffer.truncate(0)
        except Exception as error:
            raise _classify_http_error(error) from error

    def delete_backup(self, file_id: str) -> None:
        """Borra un respaldo remoto (retención). Un 404 se trata como ya borrado."""
        from googleapiclient.errors import HttpError

        try:
            self._files().delete(fileId=file_id).execute()
        except HttpError as error:
            if error.resp is not None and error.resp.status == 404:
                return
            raise _classify_http_error(error) from error
        except Exception as error:
            raise _classify_http_error(error) from error
