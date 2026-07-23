"""Normalización del dominio base público de la instalación (``app_base_url``).

El dominio se usa para construir URLs absolutas (enlaces de correo, redirect URIs
de OAuth). Entra al sistema solo por rutas con confianza de operador: el bootstrap
(token de setup, un solo uso) o la verificación por reto HMAC (``verify-domain``).
"""

from urllib.parse import urlsplit


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
