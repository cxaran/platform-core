import math
from datetime import timedelta
from typing import cast

from backend.app.core.database import SessionDep
from backend.app.core.redis import redis_client
from backend.app.core.settings import settings
from backend.app.utils.utc_now import utc_now
from backend.app.models.user import User
from backend.app.utils.email import send_email

from .security import generate_token, save_user
from .token_store import delete_token_pair, get_subject, get_token, set_token_pair

UNLOCK_TOKEN_KEY = "unlock_token"
FAILED_LOGIN_ATTEMPTS_KEY = "failed_login_attempts"


def _failed_logins_key(user_id: str) -> str:
    return f"{FAILED_LOGIN_ATTEMPTS_KEY}:{user_id}"


def get_locked_time(failed_attempts: int, factor: float = 2.2) -> int:
    return math.floor(factor ** (failed_attempts - 1))


async def increment_failed_login_attempts(
    session: SessionDep,
    user: User,
) -> None:
    user_id = str(user.id)
    failed_logins_key = _failed_logins_key(user_id)
    failed_attempts = cast(int, redis_client.incr(failed_logins_key))

    if failed_attempts < settings.trys_before_lock:
        return

    lock_minutes = get_locked_time(failed_attempts)
    old_token = get_token(UNLOCK_TOKEN_KEY, user_id)
    token = old_token or generate_token()
    ttl = lock_minutes * 60
    set_token_pair(UNLOCK_TOKEN_KEY, user_id, token, ttl)

    locked_until = utc_now() + timedelta(minutes=lock_minutes)
    user.locked_until = locked_until
    save_user(session, user)

    if old_token:
        return

    await send_email(
        subject="Cuenta bloqueada",
        email_to=user.email,
        message=f"Tu cuenta ha sido bloqueada por {lock_minutes} minutos. Token de desbloqueo: {token}",
    )


def clear_failed_login_attempts(user: User) -> None:
    user_id = str(user.id)
    token = get_token(UNLOCK_TOKEN_KEY, user_id)

    pipe = redis_client.pipeline()  # pyright: ignore[reportUnknownMemberType]
    pipe.delete(_failed_logins_key(user_id))
    pipe.execute()

    delete_token_pair(UNLOCK_TOKEN_KEY, user_id, token)


def unlock_user_by_token(
    session: SessionDep,
    token: str,
) -> User | None:
    user_id = get_subject(UNLOCK_TOKEN_KEY, token)
    if not user_id:
        return None

    user = session.get(User, user_id)
    if not user:
        return None

    user.locked_until = None
    save_user(session, user)

    pipe = redis_client.pipeline()  # pyright: ignore[reportUnknownMemberType]
    pipe.delete(_failed_logins_key(user_id))
    pipe.execute()

    delete_token_pair(UNLOCK_TOKEN_KEY, user_id, token)

    return user
