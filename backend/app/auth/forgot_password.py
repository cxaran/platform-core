from uuid import UUID

from pydantic import EmailStr, SecretStr
from sqlalchemy.exc import IntegrityError

from urllib.parse import quote

from backend.app.core.database import SessionDep
from backend.app.models.user import User
from backend.app.services.email_service import action_email_html, send_system_email
from backend.app.services.system_settings_service import (
    email_token_minutes_effective,
    installation_base_url,
)

from .security import generate_token, get_password_hash, get_user_by_email, save_user, verify_password
from .token_store import delete_token_pair, get_subject, set_token_pair

PASSWORD_RESET_TOKEN_KEY = "password_reset_token"


async def send_password_reset_token(
    session: SessionDep,
    email: EmailStr,
) -> str | None:
    user = get_user_by_email(session, email)
    if not user or not user.is_active:
        return None

    user_id = str(user.id)
    token = generate_token()
    ttl = email_token_minutes_effective(session) * 60
    set_token_pair(PASSWORD_RESET_TOKEN_KEY, user_id, token, ttl)

    # Con dominio de instalación: botón/enlace que prellena el token en la página
    # de restablecimiento. Sin él: token en texto, como antes.
    base = installation_base_url(session)
    message = f"Hola {user.name}, tu token para recuperar la contraseña es: {token}"
    html = None
    if base:
        link = f"{base}/reset-password?token={quote(token)}"
        message = f"{message}\n\nRestablece tu contraseña aquí: {link}"
        html = action_email_html(
            message=f"Hola {user.name}, tu token para recuperar la contraseña es: {token}",
            action_url=link,
            action_label="Restablecer contraseña",
        )

    await send_system_email(
        session,
        subject="Recuperar contraseña",
        email_to=email,
        message=message,
        html=html,
    )

    return token


def get_password_reset_user(
    session: SessionDep,
    token: str,
) -> User | None:
    user_id = get_subject(PASSWORD_RESET_TOKEN_KEY, token)
    if not user_id:
        return None

    try:
        return session.get(User, UUID(user_id))
    except ValueError:
        return None


def reset_password(
    session: SessionDep,
    email: EmailStr,
    token: str,
    password: SecretStr,
) -> User | None:
    try:
        user = get_password_reset_user(session, token)
        if not user or not user.is_active or user.email != email:
            return None

        if verify_password(password, user.hashed_password):
            return None

        user.hashed_password = get_password_hash(password)
        user.locked_until = None
        user.token = generate_token()
        save_user(session, user)

        delete_token_pair(PASSWORD_RESET_TOKEN_KEY, str(user.id), token)

        return user

    except IntegrityError:
        session.rollback()

    return None
