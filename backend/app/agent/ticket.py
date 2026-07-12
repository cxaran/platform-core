"""Emisión y verificación del ticket de conexión al Agent Gateway.

Puente firmado y efímero entre FastAPI (autoridad de datos y RBAC) y el Agent Gateway
(autoridad del proveedor de IA). El ticket es un JWT HS256 corto que NO transporta
datos del negocio, permisos ni PII más allá del ``user_id``: solo prueba que un usuario
con sesión válida autorizó abrir una conexión y queda atado a la versión de sesión
actual (``sid``), de modo que rotar la sesión invalida tickets emitidos antes.

``verify_connection_ticket`` se expone como utilidad pura y reusable: la usará el
Agent Gateway para validar el ticket recibido del navegador.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import jwt

from backend.app.core.settings import settings
from backend.app.models.user import User

# Audiencia esperada del ticket: solo el Agent Gateway debe aceptarlo.
TICKET_AUDIENCE = "agent-gateway"
TICKET_ALGORITHM = "HS256"


def _ticket_secret() -> str:
    return settings.agent_gateway_ticket_signing_secret.get_secret_value()


def issue_connection_ticket(user: User, ttl_seconds: int | None = None) -> tuple[str, datetime]:
    """Emite un ticket de conexión para ``user`` y devuelve ``(ticket, expires_at)``.

    El ttl es corto; ``ttl_seconds`` permite pasar la política efectiva de
    ``system_settings`` (fallback: ``settings.agent_gateway_ticket_ttl_seconds``).
    ``sid`` ata el ticket a la versión de sesión vigente del usuario (``User.token``).
    """
    # Epoch UTC consciente de zona: el ticket es portable entre procesos (Gateway)
    # y no debe depender de la TZ del host que lo emite.
    now = datetime.now(timezone.utc)
    effective_ttl = ttl_seconds or settings.agent_gateway_ticket_ttl_seconds
    expires_at = now + timedelta(seconds=effective_ttl)
    claims: dict[str, Any] = {
        "sub": str(user.id),
        "sid": user.token or "",
        "aud": TICKET_AUDIENCE,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    ticket = jwt.encode(claims, _ticket_secret(), algorithm=TICKET_ALGORITHM)
    return ticket, expires_at


def verify_connection_ticket(token: str) -> dict[str, Any]:
    """Verifica firma, audiencia y expiración del ticket y devuelve sus claims.

    Lanza ``jwt.PyJWTError`` (p. ej. ``ExpiredSignatureError``,
    ``InvalidAudienceError``, ``InvalidSignatureError``) si el ticket no es válido.
    """
    return jwt.decode(
        token,
        _ticket_secret(),
        algorithms=[TICKET_ALGORITHM],
        audience=TICKET_AUDIENCE,
        options={"require": ["sub", "sid", "aud", "iat", "exp"]},
    )
