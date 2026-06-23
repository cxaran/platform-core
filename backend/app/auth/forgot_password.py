from pydantic import EmailStr, SecretStr
from sqlalchemy.exc import IntegrityError

from backend.app.core.database import SessionDep
from backend.app.core.settings import settings
from backend.app.models.user import User
from backend.app.utils.email import send_email

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
    ttl = settings.email_token_expire_minutes * 60
    set_token_pair(PASSWORD_RESET_TOKEN_KEY, user_id, token, ttl)

    await send_email(
        subject="Recuperar contraseña",
        email_to=email,
        message=f"Hola {user.name}, tu token para recuperar la contraseña es: {token}",
    )

    return token


def get_password_reset_user(
    session: SessionDep,
    token: str,
) -> User | None:
    user_id = get_subject(PASSWORD_RESET_TOKEN_KEY, token)
    if not user_id:
        return None

    return session.get(User, user_id)


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
