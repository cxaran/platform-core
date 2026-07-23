from pydantic import EmailStr
from sqlalchemy.exc import IntegrityError

from backend.app.core.database import SessionDep
from backend.app.models.user import User
from backend.app.schemas.auth import RegisterCompleteRequest
from backend.app.services.email_service import send_system_email, token_action_email
from backend.app.services.system_settings_service import email_token_minutes_effective

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
    ttl = email_token_minutes_effective(session) * 60
    set_token_pair(REGISTER_TOKEN_KEY, str(email), token, ttl)

    message, html = token_action_email(
        session,
        intro=f"Tu token de registro es: {token}",
        token=token,
        path="/register/complete",
        action_label="Completar registro",
        action_hint="Completa tu registro aquí",
    )

    await send_system_email(
        session,
        subject="Solicitud de registro",
        email_to=email,
        message=message,
        html=html,
    )

    return token


def get_registration_email(token: str) -> str | None:
    return get_subject(REGISTER_TOKEN_KEY, token)


def create_user(
    session: SessionDep,
    user_data: RegisterCompleteRequest,
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
