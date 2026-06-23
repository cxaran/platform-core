from pydantic import EmailStr
from sqlalchemy.exc import IntegrityError

from backend.app.core.database import SessionDep
from backend.app.core.settings import settings
from backend.app.models.user import User
from backend.app.schemas.user import UserCreate
from backend.app.utils.email import send_email

from .security import generate_token, get_password_hash, get_user_by_email, save_user
from .token_store import delete_token_pair, get_subject, set_token_pair

REGISTER_TOKEN_KEY = "register_token"


async def send_registration_token(
    session: SessionDep,
    email: EmailStr,
) -> str | None:
    if get_user_by_email(session, email):
        return None

    token = generate_token()
    ttl = settings.email_token_expire_minutes * 60
    set_token_pair(REGISTER_TOKEN_KEY, str(email), token, ttl)

    await send_email(
        subject="Solicitud de registro",
        email_to=email,
        message=f"Tu token de registro es: {token}",
    )

    return token


def get_registration_email(token: str) -> str | None:
    return get_subject(REGISTER_TOKEN_KEY, token)


def create_user(
    session: SessionDep,
    user_data: UserCreate,
) -> User | None:
    try:
        email = get_registration_email(user_data.token)
        if email is None or email != user_data.email:
            return None

        new_user = User(
            name=user_data.name,
            last_name=user_data.last_name,
            email=email,
            hashed_password=get_password_hash(user_data.password),
            token=generate_token(),
        )

        save_user(session, new_user)
        delete_token_pair(REGISTER_TOKEN_KEY, email, user_data.token)

        return new_user

    except IntegrityError:
        session.rollback()

    return None
