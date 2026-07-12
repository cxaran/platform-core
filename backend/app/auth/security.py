import secrets

import jwt
from datetime import timedelta, timezone
from passlib.context import CryptContext
from pydantic import EmailStr, SecretStr
from sqlmodel import select

from backend.app.core.database import SessionDep
from backend.app.core.settings import settings
from backend.app.models.user import User
from backend.app.schemas.auth import TokenPayload
from backend.app.utils.utc_now import utc_now


password_context = CryptContext(schemes=["argon2"], deprecated="auto")
_DUMMY_HASH = password_context.hash("invalid")


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def get_user_by_email(session: SessionDep, email: EmailStr) -> User | None:
    return session.exec(select(User).where(User.email == email)).first()


def save_user(session: SessionDep, user: User) -> User:
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def get_access_token_ttl() -> timedelta:
    return timedelta(minutes=settings.access_token_expire_minutes)


def create_access_token(
    subject: str, user_token: str | None = None, ttl: timedelta | None = None
) -> str:
    """Emite el JWT de sesión. ``ttl`` permite sesiones diferenciadas (cliente
    larga vs personal corta); omitido usa ``access_token_expire_minutes``."""
    # utc_now() es naive-UTC: convertir a epoch vía .timestamp() lo interpretaría
    # como hora LOCAL (bug detectado en E2E sobre host no-UTC: el JWT nacía
    # "en el futuro" e iat lo rechazaba). Se fija la zona ANTES de convertir.
    now = utc_now().replace(tzinfo=timezone.utc)
    payload = TokenPayload(
        sub=subject,
        exp=int((now + (ttl or get_access_token_ttl())).timestamp()),
        iat=int(now.timestamp()),
        jti=user_token or "",
    )

    return jwt.encode(payload.model_dump(), settings.secret_key.get_secret_value(), algorithm=settings.algorithm)


def verify_password(password: SecretStr, hashed_password: str) -> bool:
    return password_context.verify(password.get_secret_value(), hashed_password)


def verify_dummy_password(password: SecretStr) -> None:
    """Verifica contra un hash inválido para igualar el tiempo de respuesta cuando el usuario no existe (mitigación de timing attacks)."""
    password_context.verify(password.get_secret_value(), _DUMMY_HASH)


def decode_jwt(token: str) -> TokenPayload:
    payload = jwt.decode(
        token,
        settings.secret_key.get_secret_value(),
        algorithms=[settings.algorithm],
        options={"require": ["sub", "exp", "iat", "jti"]},
    )
    return TokenPayload.model_validate(payload)


def get_password_hash(password: SecretStr) -> str:
    return password_context.hash(password.get_secret_value())
