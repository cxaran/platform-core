"""Orígenes confiables VERIFICADOS en runtime (dominio base de la instalación).

El guard CSRF combina los orígenes del entorno (``settings.trusted_origins``) con el
dominio base verificado por el administrador (system_settings.app_base_url). Regla de
seguridad: este set solo AÑADE orígenes — jamás reemplaza los del entorno, así un
dominio mal guardado nunca puede dejarte fuera de la instalación.

El set vive en memoria por proceso: se carga en el arranque (lifespan) desde la fila
y se actualiza al verificar un dominio nuevo. Los workers de Taskiq no sirven HTTP,
así que no lo necesitan.
"""

import logging
from urllib.parse import urlsplit

logger = logging.getLogger("backend.security")

_VERIFIED_ORIGINS: set[str] = set()


def normalize_base_url(raw: str) -> str | None:
    """Normaliza un dominio base a origen (esquema://host[:puerto]) o ``None``.

    Rechaza: esquemas no http(s), credenciales embebidas, path/query/fragment y
    formas vacías. No resuelve DNS (la verificación por nonce es la prueba real).
    """
    candidate = (raw or "").strip()
    if not candidate:
        return None
    parts = urlsplit(candidate)
    if parts.scheme not in ("http", "https"):
        return None
    if not parts.hostname or parts.username or parts.password:
        return None
    if parts.path not in ("", "/") or parts.query or parts.fragment:
        return None
    host = parts.hostname.lower()
    if parts.port is not None:
        return f"{parts.scheme}://{host}:{parts.port}"
    return f"{parts.scheme}://{host}"


def add_verified_origin(origin: str) -> None:
    normalized = normalize_base_url(origin)
    if normalized is not None:
        _VERIFIED_ORIGINS.add(normalized)


def verified_origins() -> frozenset[str]:
    return frozenset(_VERIFIED_ORIGINS)


def load_from_database() -> None:
    """Carga el dominio verificado persistido (llamado desde el lifespan; los fallos
    no bloquean el arranque — el guard sigue con los orígenes del entorno)."""
    try:
        from sqlmodel import Session, select

        from backend.app.core.database import engine
        from backend.app.models.system_settings import SystemSettings

        with Session(engine) as session:
            row = session.exec(select(SystemSettings)).first()
            if row is not None and row.app_base_url and row.app_base_url_verified_at:
                add_verified_origin(row.app_base_url)
    except Exception:
        logger.warning("runtime origins: no se pudo cargar el dominio verificado")
