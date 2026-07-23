"""Segundo paso de inicio de sesión verificado por correo (código o enlace).

La política vive en ``system_settings.login_verification_mode`` (``disabled`` |
``code`` | ``link``). Con el modo activo, un login con credenciales válidas NO
emite sesión: crea un RETO efímero en Redis ligado a una cookie de navegador y
envía por correo el secreto (código de 6 dígitos o token de enlace). La sesión
nace sólo al verificar el secreto DESDE EL MISMO NAVEGADOR que inició el login
(la cookie del reto es la que impide fijar la sesión reenviando el enlace).

Excepciones por diseño (decisión de producto):
- Los usuarios con COBERTURA ADMINISTRATIVA COMPLETA nunca pasan por el reto:
  son la garantía de que un transporte de correo roto jamás deja la instalación
  sin acceso (la salida de emergencia adicional es el seed CLI).
- Los clientes Bearer no re-verifican: el reto aplica sólo a la creación de la
  sesión de navegador.

Seguridad: secreto con hash SHA-256 en Redis (nunca en claro), consumo único,
tope de intentos por reto, TTL corto (``EMAIL_TOKEN_EXPIRE_MINUTES``) y
comparación en tiempo constante. Anti-enumeración intacta: nada de esto ocurre
antes de validar la contraseña.
"""

import hashlib
import hmac
import logging
import secrets
from typing import Optional, cast

from fastapi import Request, Response
from sqlmodel import Session

from backend.app.core.redis import RedisText, redis_client, redis_text
from backend.app.core.settings import settings
from backend.app.models.user import User

logger = logging.getLogger("backend.security")

CHALLENGE_COOKIE_KEY = "login_challenge"
_CHALLENGE_PREFIX = "login-verify"
_ATTEMPTS_PREFIX = "login-verify-attempts"
# Tope de intentos de código por reto: al agotarse, el reto se destruye y el
# usuario debe iniciar sesión de nuevo (el lockout de contraseña sigue aparte).
MAX_VERIFY_ATTEMPTS = 5

MODE_CODE = "code"
MODE_LINK = "link"



def _ttl_seconds(minutes: int | None = None) -> int:
    """TTL en segundos. ``minutes`` viene de la política efectiva cuando el llamador
    tiene sesión de BD; sin él (p. ej. el contador interno de intentos en la
    verificación, que no abre sesión) se usa el default del despliegue."""
    return (minutes or settings.email_token_expire_minutes) * 60


def _hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def _challenge_key(challenge_id: str) -> str:
    return f"{_CHALLENGE_PREFIX}:{challenge_id}"


def _attempts_key(challenge_id: str) -> str:
    return f"{_ATTEMPTS_PREFIX}:{challenge_id}"


def _store_challenge(
    challenge_id: str, user_id: str, secret_hash: str, ttl_seconds: int | None = None
) -> None:
    redis_client.setex(
        _challenge_key(challenge_id),
        ttl_seconds if ttl_seconds is not None else _ttl_seconds(),
        f"{user_id}:{secret_hash}",
    )


def _load_challenge(challenge_id: str) -> Optional[tuple[str, str]]:
    raw = cast("RedisText | None", redis_client.get(_challenge_key(challenge_id)))
    if not raw:
        return None
    user_id, _, secret_hash = redis_text(raw).partition(":")
    if not user_id or not secret_hash:
        return None
    return user_id, secret_hash


def _delete_challenge(challenge_id: str) -> None:
    pipe = redis_client.pipeline()  # pyright: ignore[reportUnknownMemberType]
    pipe.delete(_challenge_key(challenge_id))
    pipe.delete(_attempts_key(challenge_id))
    pipe.execute()


def _bump_attempts(challenge_id: str) -> int:
    key = _attempts_key(challenge_id)
    attempts = cast(int, redis_client.incr(key))
    if attempts == 1:
        redis_client.expire(key, _ttl_seconds())
    return attempts


def generate_secret(mode: str) -> str:
    """Código corto de 6 dígitos (modo code) o token urlsafe largo (modo link)."""
    if mode == MODE_CODE:
        return f"{secrets.randbelow(1_000_000):06d}"
    return secrets.token_urlsafe(32)


def user_requires_verification(session: Session, user: User, mode: str) -> bool:
    """¿Este usuario debe pasar por el reto?

    Los usuarios con cobertura administrativa COMPLETA quedan exentos SIEMPRE:
    garantizan acceso a la instalación aunque el correo esté roto.
    """
    if mode not in (MODE_CODE, MODE_LINK):
        return False
    from backend.app.security.admin_survival import user_has_full_admin_coverage

    return not user_has_full_admin_coverage(session, user.id)


def verification_base_url(session: Session) -> str:
    """Origen del enlace de verificación: la URL de la instalación declarada por
    el administrador. Nunca se deriva de headers de la solicitud (el enlace viaja
    por correo y solo puede apuntar al dominio del operador). Sin URL declarada
    queda vacío y el correo degrada al modo código."""
    from backend.app.services.system_settings_service import installation_base_url

    return installation_base_url(session) or ""


async def start_login_challenge(
    session: Session,
    user: User,
    mode: str,
    response: Response,
) -> bool:
    """Crea el reto, envía el correo y liga la cookie de navegador.

    Devuelve ``False`` (sin efectos persistentes) si el correo no pudo enviarse:
    el llamador responde el error honesto en lugar de dejar al usuario en limbo.
    """
    from backend.app.services.email_service import send_system_email
    from backend.app.services.system_settings_service import (
        email_token_minutes_effective,
        project_display_name,
    )

    challenge_id = secrets.token_urlsafe(32)
    secret = generate_secret(mode)
    # Política efectiva (editable en runtime): vigencia del reto y nombre visible.
    ttl_minutes = email_token_minutes_effective(session)
    display_name = project_display_name(session)

    if mode == MODE_CODE:
        subject = f"{display_name}: código de inicio de sesión"
        message = (
            f"Hola {user.name}, tu código de inicio de sesión es: {secret}\n\n"
            f"Caduca en {ttl_minutes} minutos. Si no "
            "intentaste iniciar sesión, ignora este correo."
        )
    else:
        link = f"{verification_base_url(session)}/login/verify?token={secret}"
        subject = f"{display_name}: enlace de inicio de sesión"
        message = (
            f"Hola {user.name}, confirma tu inicio de sesión abriendo este enlace "
            f"EN EL MISMO NAVEGADOR donde lo iniciaste:\n\n{link}\n\n"
            f"Caduca en {ttl_minutes} minutos. Si no "
            "intentaste iniciar sesión, ignora este correo."
        )

    outcome = await send_system_email(session, subject=subject, email_to=user.email, message=message)
    if not outcome.sent:
        logger.warning("login verification email failed: %s", outcome.error_code)
        return False

    _store_challenge(challenge_id, str(user.id), _hash_secret(secret), _ttl_seconds(ttl_minutes))
    response.set_cookie(
        key=CHALLENGE_COOKIE_KEY,
        value=challenge_id,
        httponly=True,
        max_age=_ttl_seconds(ttl_minutes),
        samesite="lax",
        secure=settings.environment == "production",
        path="/",
    )
    return True


def verify_login_challenge(request: Request, secret: str) -> Optional[str]:
    """Valida el secreto contra el reto del NAVEGADOR (cookie); ``user_id`` o ``None``.

    Consumo único: el éxito destruye el reto. El tope de intentos también lo
    destruye (un código de 6 dígitos jamás debe ser fuerza-brutable).
    """
    challenge_id = request.cookies.get(CHALLENGE_COOKIE_KEY, "")
    if not challenge_id:
        return None
    stored = _load_challenge(challenge_id)
    if stored is None:
        return None

    if _bump_attempts(challenge_id) > MAX_VERIFY_ATTEMPTS:
        _delete_challenge(challenge_id)
        return None

    user_id, secret_hash = stored
    if not hmac.compare_digest(secret_hash, _hash_secret(secret.strip())):
        return None

    _delete_challenge(challenge_id)
    return user_id


def clear_challenge_cookie(response: Response) -> None:
    response.delete_cookie(key=CHALLENGE_COOKIE_KEY, path="/")
