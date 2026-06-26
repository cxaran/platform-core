from fastapi import APIRouter, HTTPException, Request, Response, status

from backend.app.api.resource_actions import api_error
from backend.app.auth.auth import authenticate, delete_session_cookie, set_session_cookie
from backend.app.auth.auth_dependencies import CurrentUser
from backend.app.auth.account_lock import unlock_user_by_token
from backend.app.auth.forgot_password import reset_password, send_password_reset_token
from backend.app.auth.register import create_user, send_registration_token
from backend.app.core.database import SessionDep
from backend.app.core.settings import settings
from backend.app.schemas.auth import (
    AuthPolicyRead,
    ForgotPasswordRequest,
    LoginRequest,
    MessageResponse,
    RegisterCompleteRequest,
    RegisterRequest,
    ResetPasswordRequest,
    UnlockAccountRequest,
)
from backend.app.schemas.user import SessionUser
from backend.app.security.rate_limit import (
    limit_forgot_password,
    limit_login,
    limit_register_complete,
    limit_register_request,
    limit_reset_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _require_registration_enabled() -> None:
    if not settings.registration_enabled:
        api_error(
            status.HTTP_403_FORBIDDEN,
            "registration_disabled",
            "El registro de cuentas no está disponible.",
        )


def _require_password_reset_enabled() -> None:
    if not settings.password_reset_enabled:
        api_error(
            status.HTTP_403_FORBIDDEN,
            "password_reset_disabled",
            "La recuperación de contraseña no está disponible.",
        )


@router.get("/policy", response_model=AuthPolicyRead)
def read_auth_policy() -> AuthPolicyRead:
    """Política pública de auth. El frontend la consume; no infiere de settings."""
    return AuthPolicyRead(
        registration_enabled=settings.registration_enabled,
        password_reset_enabled=settings.password_reset_enabled,
    )


@router.get("/me", response_model=SessionUser)
def read_current_user(current_user: CurrentUser) -> SessionUser:
    return current_user


@router.post("/login", response_model=MessageResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    session: SessionDep,
) -> MessageResponse:
    limit_login(request, str(payload.email))
    token = await authenticate(session, payload.email, payload.password)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales inválidas",
        )

    set_session_cookie(response, token)
    return MessageResponse(message="Sesión iniciada correctamente")


@router.post("/logout", response_model=MessageResponse)
def logout(response: Response, _: CurrentUser) -> MessageResponse:
    """Cierra la sesión actual borrando la cookie httponly.

    Requiere sesión válida; no rota ``User.token`` (no es un cierre de sesión en
    todos los dispositivos, solo el actual)."""
    delete_session_cookie(response)
    return MessageResponse(message="Sesión cerrada correctamente")


@router.post("/register/request", response_model=MessageResponse, status_code=status.HTTP_202_ACCEPTED)
async def request_registration(
    payload: RegisterRequest,
    request: Request,
    session: SessionDep,
) -> MessageResponse:
    _require_registration_enabled()
    limit_register_request(request, str(payload.email))
    await send_registration_token(session, payload.email)
    return MessageResponse(message="Si el email es válido, se enviará un token de registro")


@router.post("/register/complete", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
def complete_registration(
    payload: RegisterCompleteRequest,
    request: Request,
    session: SessionDep,
) -> MessageResponse:
    _require_registration_enabled()
    limit_register_complete(request)
    user = create_user(session, payload)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token de registro inválido o expirado",
        )
    return MessageResponse(message="Usuario registrado correctamente")


@router.post("/unlock", response_model=MessageResponse)
def unlock_account(
    payload: UnlockAccountRequest,
    session: SessionDep,
) -> MessageResponse:
    user = unlock_user_by_token(session, payload.token)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token de desbloqueo inválido o expirado",
        )
    return MessageResponse(message="Cuenta desbloqueada correctamente")


@router.post("/password/forgot", response_model=MessageResponse, status_code=status.HTTP_202_ACCEPTED)
async def request_password_reset(
    payload: ForgotPasswordRequest,
    request: Request,
    session: SessionDep,
) -> MessageResponse:
    _require_password_reset_enabled()
    limit_forgot_password(request, str(payload.email))
    await send_password_reset_token(session, payload.email)
    return MessageResponse(message="Si el email es válido, se enviará un token de recuperación")


@router.post("/password/reset", response_model=MessageResponse)
def complete_password_reset(
    payload: ResetPasswordRequest,
    request: Request,
    session: SessionDep,
) -> MessageResponse:
    _require_password_reset_enabled()
    limit_reset_password(request, payload.token)
    user = reset_password(session, payload.email, payload.token, payload.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token de recuperación inválido o expirado",
        )
    return MessageResponse(message="Contraseña actualizada correctamente")
