from datetime import timedelta

import jwt
from fastapi import Response
from pydantic import EmailStr, SecretStr
from sqlmodel import select


from backend.app.core.database import SessionDep
from backend.app.core.settings import settings
from backend.app.models.user import User, UserRole
from backend.app.utils.utc_now import utc_now

from .account_lock import increment_failed_login_attempts, clear_failed_login_attempts
from .security import verify_password, verify_dummy_password, create_access_token, get_access_token_ttl, get_user_by_email

SESSION_COOKIE_KEY = "session_token"
LOCAL_DOMAINS = {"localhost", "127.0.0.1", "0.0.0.0"}


def session_ttl_for_user(session: SessionDep, user: User) -> timedelta:
    """TTL de sesión según el tipo de usuario.

    Un usuario CON roles (personal: opera panel/admin) recibe la sesión corta;
    un CLIENTE (sin roles) recibe la sesión larga — compra una vez al mes y no
    debe volver a iniciar sesión. Ambas duraciones son POLÍTICA editable en
    ``system_settings`` (sembrada desde el bootstrap), con los valores del
    despliegue como default. La renovación deslizante las extiende mientras
    haya actividad; rotar ``User.token`` (contraseña/correo/forzar logout)
    invalida todas al instante.
    """
    from backend.app.services.system_settings_service import (
        customer_session_days_effective,
        staff_session_minutes_effective,
    )

    has_role = (
        session.exec(select(UserRole.id).where(UserRole.user_id == user.id).limit(1)).first()
        is not None
    )
    if has_role:
        return timedelta(minutes=staff_session_minutes_effective(session))
    return timedelta(days=customer_session_days_effective(session))


async def authenticate(
    session: SessionDep,
    email: EmailStr,
    password: SecretStr,
) -> str | None:
    user = get_user_by_email(session, email)

    if not user or not user.is_active:
        verify_dummy_password(password)
        return None

    if user.locked_until and utc_now() < user.locked_until:
        return None

    if not verify_password(password, user.hashed_password):
        await increment_failed_login_attempts(session, user)
        return None

    clear_failed_login_attempts(user)

    return create_access_token(str(user.id), user.token, ttl=session_ttl_for_user(session, user))


def set_session_cookie(
    response: Response,
    token: str,
) -> None:
    # El max_age se deriva del PROPIO token (exp - iat): la cookie y el JWT
    # expiran juntos sin importar el TTL con el que se emitió la sesión.
    try:
        payload = jwt.decode(
            token,
            settings.secret_key.get_secret_value(),
            algorithms=[settings.algorithm],
            options={"verify_exp": False},
        )
        max_age = int(payload["exp"]) - int(payload["iat"])
    except (jwt.InvalidTokenError, KeyError, ValueError):
        max_age = int(get_access_token_ttl().total_seconds())
    response.set_cookie(
        key=SESSION_COOKIE_KEY,
        value=token,
        httponly=True,
        max_age=max_age,
        samesite="lax",
        secure=settings.environment == "production",
        path="/",
    )


def delete_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_KEY,
        path="/",
    )
