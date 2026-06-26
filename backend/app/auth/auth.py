from fastapi import Response
from pydantic import EmailStr, SecretStr


from backend.app.core.database import SessionDep
from backend.app.core.settings import settings
from backend.app.utils.utc_now import utc_now

from .account_lock import increment_failed_login_attempts, clear_failed_login_attempts
from .security import verify_password, verify_dummy_password, create_access_token, get_access_token_ttl, get_user_by_email

SESSION_COOKIE_KEY = "session_token"
LOCAL_DOMAINS = {"localhost", "127.0.0.1", "0.0.0.0"}



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

    return create_access_token(str(user.id), user.token)


def set_session_cookie(
    response: Response,
    token: str,
) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_KEY,
        value=token,
        httponly=True,
        max_age=int(get_access_token_ttl().total_seconds()),
        samesite="lax",
        secure=settings.environment == "production",
        path="/",
    )


def delete_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_KEY,
        path="/",
    )
