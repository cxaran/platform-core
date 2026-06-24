from typing import Annotated, cast
from fastapi import Cookie, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlmodel import select

from backend.app.core.database import SessionDep
from backend.app.models.user import RoleAccess, User, UserRole
from backend.app.schemas.user import SessionUser

from .security import decode_jwt

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/api/v1/auth/login",
    auto_error=False,
)


def _unauthorized_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No se pudo validar el usuario",
    )


def get_token(
    session_token: str | None = Cookie(None),
    bearer_token: str | None = Depends(oauth2_scheme),
) -> str | None:
    return bearer_token or session_token


def build_current_user(
    session: SessionDep,
    user: User,
) -> SessionUser:
    stmt = (
        select(RoleAccess.access)
        .join_from(RoleAccess, UserRole, RoleAccess.role_id == UserRole.role_id)
        .where(UserRole.user_id == user.id)
    )
    permissions = cast("list[str]", session.exec(stmt).all())
    base_user = SessionUser.model_validate(user, from_attributes=True)
    base_user.permissions = set(permissions)
    return base_user


def get_current_user(
    session: SessionDep,
    token: str | None = Depends(get_token),
) -> SessionUser:
    if not token:
        raise _unauthorized_error()

    try:
        data = decode_jwt(token)
    except Exception:
        raise _unauthorized_error()

    user = session.get(User, data.sub)
    if not user or not user.is_active or user.token != data.jti:
        raise _unauthorized_error()

    return build_current_user(session, user)


CurrentUser = Annotated[SessionUser, Depends(get_current_user)]
