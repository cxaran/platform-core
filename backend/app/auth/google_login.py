"""Inicio de sesión (y alta) con Google — OIDC de una sola organización.

La política y las credenciales viven en ``system_settings`` (flag
``google_login_enabled``; ``google_auth_client_id`` en claro y el client secret
CIFRADO write-only con la clave maestra), configuradas después del bootstrap —
el asistente jamás recibe secretos de terceros. El estado del flujo es efímero
en Redis (hasheado, consumo único, TTL corto), como los retos de login.

Resolución del callback (el ``sub`` del id_token es la identidad; el correo es
sólo un puente, y únicamente cuando Google lo reporta VERIFICADO):

1. Identidad ya vinculada           → sesión.
2. Correo verificado de un usuario  → vincular identidad y sesión.
   activo existente
3. Sin usuario y con el registro    → crear usuario ACTIVO SIN ROLES (idéntico
   público efectivo abierto           al registro por correo) y sesión.
4. Cualquier otro caso              → rechazo genérico (sin filtrar la causa).

El login con Google NO pasa por la verificación de login por correo (Google ya
autenticó y es dueño del buzón). Los usuarios nacidos de Google quedan sin
contraseña utilizable; pueden fijar una con el flujo de recuperación.
"""

import hashlib
import logging
import secrets
from dataclasses import dataclass
from typing import Optional, cast
from urllib.parse import urlencode

from fastapi import Request
from sqlmodel import Session, select

from backend.app.core.redis import RedisText, redis_client, redis_text
from backend.app.core.settings import settings
from backend.app.models.user import User
from backend.app.models.user_identity import UserIdentity

logger = logging.getLogger("backend.security")

GOOGLE_PROVIDER = "google"
_STATE_PREFIX = "google-oauth-state"
_STATE_TTL_SECONDS = 600  # 10 minutos, como los states de OAuth de respaldos.
_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
_SCOPES = "openid email profile"


class GoogleLoginError(Exception):
    """Fallo del flujo con código estable; el detalle NO viaja al navegador."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class GoogleProfile:
    """Claims mínimos del id_token ya verificado."""

    subject: str
    email: str
    given_name: str
    family_name: str


def _state_key(state: str) -> str:
    return f"{_STATE_PREFIX}:{hashlib.sha256(state.encode('utf-8')).hexdigest()}"


def _store_state(state: str, nonce: str) -> None:
    redis_client.setex(_state_key(state), _STATE_TTL_SECONDS, nonce)


def _consume_state(state: str) -> Optional[str]:
    """Nonce del state, consumiéndolo (un state sólo se canjea una vez)."""
    key = _state_key(state)
    nonce = cast("RedisText | None", redis_client.get(key))
    if nonce is None:
        return None
    redis_client.delete(key)
    return redis_text(nonce)


def google_credentials(session: Session) -> Optional[tuple[str, str]]:
    """(client_id, client_secret) desde la configuración; ``None`` si incompleto."""
    from backend.app.services.secret_cipher import decrypt_secret
    from backend.app.services.system_settings_service import get_system_settings

    row = get_system_settings(session)
    if not row.google_auth_client_id or not row.google_auth_client_secret_ciphertext:
        return None
    secret = decrypt_secret(row.google_auth_client_secret_ciphertext)
    if not secret:
        return None
    return row.google_auth_client_id, secret


def is_google_login_enabled(session: Session) -> bool:
    """Política EFECTIVA: flag encendido Y credenciales completas y descifrables."""
    from backend.app.services.system_settings_service import get_system_settings

    if not get_system_settings(session).google_login_enabled:
        return False
    return google_credentials(session) is not None


def oauth_base_url(session: Session, request: Request) -> str:
    """Origen público del flujo (el redirect_uri debe coincidir con la consola de
    Google): el dominio VERIFICADO de la instalación o, en su defecto, el primer
    origen confiable configurado (desarrollo)."""
    from backend.app.services.system_settings_service import get_system_settings

    row = get_system_settings(session)
    if row.app_base_url and row.app_base_url_verified_at:
        return row.app_base_url.rstrip("/")
    origin = (request.headers.get("origin") or "").rstrip("/")
    if origin:
        return origin
    first = sorted(settings.trusted_origins)
    return first[0] if first else ""


def redirect_uri(session: Session, request: Request) -> str:
    return f"{oauth_base_url(session, request)}/api/v1/auth/google/callback"


def build_authorization_url(session: Session, request: Request) -> str:
    """URL de autorización de Google con state (Redis, consumo único) y nonce."""
    credentials = google_credentials(session)
    if credentials is None:
        raise GoogleLoginError("google_login_unavailable")
    client_id, _ = credentials

    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    _store_state(state, nonce)

    query = urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri(session, request),
            "response_type": "code",
            "scope": _SCOPES,
            "state": state,
            "nonce": nonce,
            "prompt": "select_account",
        }
    )
    return f"{_AUTH_ENDPOINT}?{query}"


async def exchange_code(
    session: Session, request: Request, code: str, nonce: str
) -> GoogleProfile:
    """Canjea el code, verifica el id_token (firma, audiencia, nonce) y exige
    ``email_verified`` — sin ese claim el correo NO puede usarse como puente de
    cuenta (sería un vector de robo por coincidencia de correo)."""
    import httpx
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token

    credentials = google_credentials(session)
    if credentials is None:
        raise GoogleLoginError("google_login_unavailable")
    client_id, client_secret = credentials

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
            response = await client.post(
                _TOKEN_ENDPOINT,
                data={
                    "code": code,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uri": redirect_uri(session, request),
                    "grant_type": "authorization_code",
                },
            )
    except Exception as error:
        logger.warning("google token exchange failed: %s", type(error).__name__)
        raise GoogleLoginError("google_exchange_failed") from error
    if response.status_code >= 400:
        logger.warning("google token exchange rejected: http %s", response.status_code)
        raise GoogleLoginError("google_exchange_failed")

    raw_id_token = response.json().get("id_token")
    if not raw_id_token:
        raise GoogleLoginError("google_exchange_failed")

    try:
        claims = google_id_token.verify_oauth2_token(
            raw_id_token, google_requests.Request(), audience=client_id
        )
    except Exception as error:
        logger.warning("google id_token verification failed: %s", type(error).__name__)
        raise GoogleLoginError("google_token_invalid") from error

    if claims.get("nonce") != nonce:
        raise GoogleLoginError("google_token_invalid")
    if not claims.get("sub"):
        raise GoogleLoginError("google_token_invalid")
    if not claims.get("email") or claims.get("email_verified") is not True:
        raise GoogleLoginError("google_email_unverified")

    return GoogleProfile(
        subject=str(claims["sub"]),
        email=str(claims["email"]).strip().lower(),
        given_name=str(claims.get("given_name") or "").strip(),
        family_name=str(claims.get("family_name") or "").strip(),
    )


def resolve_user(session: Session, profile: GoogleProfile) -> User:
    """Identidad → usuario, con vínculo por correo VERIFICADO o alta gobernada."""
    from backend.app.auth.security import generate_token, get_password_hash, get_user_by_email
    from backend.app.services.system_settings_service import is_public_registration_enabled
    from pydantic import SecretStr

    identity = session.exec(
        select(UserIdentity).where(
            UserIdentity.provider == GOOGLE_PROVIDER,
            UserIdentity.subject == profile.subject,
        )
    ).first()
    if identity is not None:
        user = session.get(User, identity.user_id)
        if user is None or not user.is_active:
            raise GoogleLoginError("google_account_unavailable")
        return user

    existing = get_user_by_email(session, profile.email)
    if existing is not None:
        if not existing.is_active:
            raise GoogleLoginError("google_account_unavailable")
        session.add(
            UserIdentity(
                provider=GOOGLE_PROVIDER,
                subject=profile.subject,
                user_id=existing.id,
                email_at_link=profile.email,
            )
        )
        session.commit()
        return existing

    if not is_public_registration_enabled(session):
        raise GoogleLoginError("google_registration_closed")

    # Alta idéntica al registro por correo: usuario ACTIVO pero SIN roles (sin
    # acceso hasta que un administrador se lo asigne) y sin contraseña utilizable
    # (puede fijar una con la recuperación por correo).
    user = User(
        name=profile.given_name or profile.email.split("@")[0],
        last_name=profile.family_name or "Google",
        email=profile.email,
        is_active=True,
        hashed_password=get_password_hash(SecretStr(secrets.token_urlsafe(32))),
        token=generate_token(),
    )
    session.add(user)
    session.flush()
    session.add(
        UserIdentity(
            provider=GOOGLE_PROVIDER,
            subject=profile.subject,
            user_id=user.id,
            email_at_link=profile.email,
        )
    )
    session.commit()
    return user
