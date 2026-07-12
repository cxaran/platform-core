"""Orígenes confiables declarados/verificados en runtime (dominio base de la instalación).

El guard CSRF combina los orígenes del entorno (``settings.trusted_origins``) con el
dominio base de la instalación (``system_settings.app_base_url``). El dominio entra a
la base SOLO por rutas con confianza de operador: el bootstrap (autenticado por el
token de setup, de un solo uso) o la verificación por reto HMAC (``verify-domain``).
Regla de seguridad: este set solo AÑADE orígenes — jamás reemplaza los del entorno,
así un dominio mal guardado nunca puede dejarte fuera de la instalación (mientras
``TRUSTED_BROWSER_ORIGINS`` — hoy opcional, un override de emergencia — esté definido).

El set vive en memoria por proceso: se carga en el arranque (lifespan) desde la fila
y se actualiza al declarar/verificar un dominio. Con múltiples workers (gunicorn) el
proceso que no atendió esa mutación no ve el cambio: el guard invoca
``refresh_from_database_if_stale`` antes de rechazar, con un intervalo mínimo para
que un atacante no convierta el fallo del guard en carga sobre PostgreSQL.

Los orígenes se guardan en la MISMA forma normalizada que compara el guard
(``scheme://host:puerto-efectivo``, vía ``normalize_browser_origin``); guardar la
forma sin puerto haría que ``https://dominio`` jamás igualara al Origin normalizado
``https://dominio:443`` del navegador.
"""

import logging
import time
from urllib.parse import urlsplit

from backend.app.core.csrf import normalize_browser_origin

logger = logging.getLogger("backend.security")

_VERIFIED_ORIGINS: set[str] = set()

# Recarga perezosa multi-worker: marca monotónica de la última carga desde la base.
_REFRESH_MIN_INTERVAL_SECONDS = 30.0
_last_load_monotonic: float | None = None


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
    if normalized is None:
        return
    # Forma comparable por el guard (puerto efectivo explícito).
    guard_form = normalize_browser_origin(normalized)
    if guard_form is not None:
        _VERIFIED_ORIGINS.add(guard_form)


def verified_origins() -> frozenset[str]:
    return frozenset(_VERIFIED_ORIGINS)


def load_from_database() -> None:
    """Carga el dominio base persistido (llamado desde el lifespan; los fallos
    no bloquean el arranque — el guard sigue con los orígenes del entorno).

    Basta con que ``app_base_url`` exista: solo se escribe desde rutas con
    confianza de operador (bootstrap con token o verificación por reto), y la
    instalación debe aceptar mutaciones desde su dominio aunque el reto HMAC
    aún no se haya corrido (p. ej. recién completado el asistente de setup).
    """
    global _last_load_monotonic
    # La marca se estampa AUNQUE la carga falle: si la base no responde, reintentar
    # en cada mutación rechazada convertiría el fallo del guard en carga extra.
    _last_load_monotonic = time.monotonic()
    try:
        from sqlmodel import Session, select

        from backend.app.core.database import engine
        from backend.app.models.system_settings import SystemSettings

        with Session(engine) as session:
            row = session.exec(select(SystemSettings)).first()
            if row is not None and row.app_base_url:
                add_verified_origin(row.app_base_url)
    except Exception:
        logger.warning("runtime origins: no se pudo cargar el dominio de la instalación")


def refresh_from_database_if_stale() -> bool:
    """Recarga desde la base si pasó el intervalo mínimo desde la última carga.

    La llama el guard CSRF ANTES de rechazar una mutación: en despliegues
    multi-worker el proceso que no atendió el bootstrap/verificación no tiene el
    origen en memoria todavía. Devuelve ``True`` si recargó.
    """
    now = time.monotonic()
    if (
        _last_load_monotonic is not None
        and now - _last_load_monotonic < _REFRESH_MIN_INTERVAL_SECONDS
    ):
        return False
    load_from_database()
    return True
