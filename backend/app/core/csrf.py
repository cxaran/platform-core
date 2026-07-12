"""Protección de mutaciones autenticadas por cookie (validación de Origin/Referer).

Para solicitudes inseguras (POST/PUT/PATCH/DELETE) autenticadas mediante la cookie
``session_token`` (y sin credencial Bearer), exige que el origen del navegador esté
en una allowlist explícita por ambiente. Bearer y métodos seguros pasan sin
comprobación. La defensa es central (middleware), se ejecuta antes del router, auth y
servicio, y no consume el cuerpo de la solicitud.
"""

from urllib.parse import urlsplit

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from backend.app.schemas.error import ErrorResponse

_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def normalize_browser_origin(value: str) -> str | None:
    """Normaliza un origen de navegador a ``scheme://host:puerto-efectivo``.

    Estricto: el valor debe representar **solo** un origen (sin path/query/fragment ni
    userinfo). Devuelve ``None`` para cualquier valor inválido o ambiguo.
    """
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if raw == "" or raw == "*" or raw.lower() == "null":
        return None

    try:
        parts = urlsplit(raw)
    except ValueError:
        return None

    scheme = parts.scheme.lower()
    if scheme not in ("http", "https"):
        return None
    if not parts.hostname:
        return None
    if parts.username or parts.password:
        return None
    # Un Origin no lleva path/query/fragment.
    if parts.path or parts.query or parts.fragment:
        return None

    try:
        port = parts.port if parts.port is not None else (443 if scheme == "https" else 80)
    except ValueError:
        return None

    return f"{scheme}://{parts.hostname.lower()}:{port}"


def _origin_from_referer(referer: str) -> str | None:
    """Reduce un Referer (URL completa con path/query) a su origen normalizado."""
    raw = referer.strip()
    try:
        parts = urlsplit(raw)
    except ValueError:
        return None
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https") or not parts.hostname:
        return None
    if parts.username or parts.password:
        return None
    try:
        port = parts.port if parts.port is not None else (443 if scheme == "https" else 80)
    except ValueError:
        return None
    return f"{scheme}://{parts.hostname.lower()}:{port}"


def _has_bearer_credential(authorization: str | None) -> bool:
    """Detecta una credencial ``Authorization: Bearer <token>`` válida en forma de esquema."""
    if not authorization:
        return False
    scheme, _, token = authorization.partition(" ")
    return scheme.lower() == "bearer" and token.strip() != ""


def _request_browser_origin(request: Request) -> str | None:
    # Si hay Origin, manda (aunque sea inválido → None → se rechaza); no se consulta Referer.
    raw_origin = request.headers.get("origin")
    if raw_origin is not None:
        return normalize_browser_origin(raw_origin)
    raw_referer = request.headers.get("referer")
    if raw_referer is not None:
        return _origin_from_referer(raw_referer)
    return None


def _forbidden() -> JSONResponse:
    body = ErrorResponse(code="csrf_origin_invalid", message="Solicitud no disponible.")
    return JSONResponse(status_code=403, content=body.model_dump(exclude_none=True))


class MutationOriginGuardMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:  # type: ignore[no-untyped-def]
        if request.method in _SAFE_METHODS:
            return await call_next(request)
        if _has_bearer_credential(request.headers.get("authorization")):
            return await call_next(request)

        # Imports diferidos para evitar el ciclo settings → csrf en tiempo de import.
        from backend.app.auth.auth import SESSION_COOKIE_KEY
        from backend.app.core.settings import get_settings

        if SESSION_COOKIE_KEY not in request.cookies:
            return await call_next(request)

        from backend.app.core.runtime_origins import (
            refresh_from_database_if_stale,
            verified_origins,
        )

        # Entorno + dominio de la instalación declarado/verificado (solo AÑADE,
        # nunca reemplaza: un dominio mal guardado no puede dejarte fuera).
        allowed = get_settings().trusted_origins | verified_origins()
        origin = _request_browser_origin(request)
        if origin is not None and origin not in allowed:
            # Multi-worker: este proceso puede no haber visto un dominio recién
            # declarado (bootstrap/verify-domain atendido por otro worker). Se
            # recarga desde la base —con intervalo mínimo— antes de rechazar.
            if refresh_from_database_if_stale():
                allowed = get_settings().trusted_origins | verified_origins()
        if origin is None or origin not in allowed:
            return _forbidden()
        return await call_next(request)
