"""Enumeraciones de dominio persistidas como enums NO nativos.

Convención: cada enum se persiste como ``VARCHAR`` + CHECK constraint
(``native_enum=False``, ``create_constraint=True``, ``values_callable=enum_values``),
no como tipo ENUM de PostgreSQL. El VARCHAR se dimensiona al valor más largo.
"""

from enum import Enum


class BackupDriveStatus(str, Enum):
    """Estado de la conexión con Google Drive para respaldos.

    ``needs_reauth`` detiene los reintentos: el token dejó de servir y sólo una
    reconexión del administrador lo resuelve. Enum NO nativo (VARCHAR + CHECK); el
    valor más largo es ``needs_reauth`` (12)."""

    DISCONNECTED = "disconnected"
    ACTIVE = "active"
    NEEDS_REAUTH = "needs_reauth"


class BackupRunStatus(str, Enum):
    """Estado de una ejecución de respaldo (historial funcional).

    Terminales: ``succeeded``, ``failed``, ``skipped`` y ``pruned`` (respaldo remoto
    rotado por retención; la fila se conserva). Enum NO nativo (VARCHAR + CHECK); el
    valor más largo es ``succeeded`` (9)."""

    QUEUED = "queued"
    RUNNING = "running"
    RETRYING = "retrying"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    SKIPPED = "skipped"
    PRUNED = "pruned"


class BackupTriggerKind(str, Enum):
    """Origen de una ejecución de respaldo: programada o manual del administrador."""

    SCHEDULED = "scheduled"
    MANUAL = "manual"


class BackupExplorerStatus(str, Enum):
    """Estado del artefacto de EXPLORACIÓN (SQLite legible) de un respaldo.

    Independiente del status principal: un respaldo restaurable correcto sigue
    ``succeeded`` aunque su explorer haya fallado. Enum NO nativo (VARCHAR + CHECK);
    el valor más largo es ``not_requested`` (13)."""

    NOT_REQUESTED = "not_requested"
    BUILDING = "building"
    READY = "ready"
    FAILED = "failed"


class AiProvider(str, Enum):
    """Proveedor de IA de una credencial registrada por el usuario.

    El valor enruta al adaptador correspondiente en el Agent Gateway. Enum NO nativo
    (VARCHAR + CHECK); el valor más largo es ``openrouter`` (10)."""

    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GEMINI = "gemini"
    OPENROUTER = "openrouter"
    OLLAMA = "ollama"


class AiCredentialType(str, Enum):
    """Tipo de credencial de proveedor de IA almacenada por el usuario.

    ``api_key`` guarda un secreto estático (API key). ``oauth`` queda reservado para
    un flujo OAuth cifrado (p. ej. ChatGPT Plus/Codex); en esta versión solo se
    implementa ``api_key``. Enum NO nativo (VARCHAR + CHECK)."""

    API_KEY = "api_key"
    OAUTH = "oauth"


def enum_values(enum_class: type[Enum]) -> list[str]:
    return [str(member.value) for member in enum_class]
