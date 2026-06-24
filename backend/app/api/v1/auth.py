from fastapi import APIRouter, HTTPException, Response, status

from backend.app.auth.auth import authenticate, set_session_cookie
from backend.app.auth.auth_dependencies import CurrentUser
from backend.app.auth.account_lock import unlock_user_by_token
from backend.app.auth.register import create_user, send_registration_token
from backend.app.core.database import SessionDep
from backend.app.schemas.auth import (
    LoginRequest,
    MessageResponse,
    RegisterRequest,
    UnlockAccountRequest,
)
from backend.app.schemas.user import SessionUser, UserCreate

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me", response_model=SessionUser)
def read_current_user(current_user: CurrentUser) -> SessionUser:
    return current_user


@router.post("/login", response_model=MessageResponse)
async def login(
    payload: LoginRequest,
    response: Response,
    session: SessionDep,
) -> MessageResponse:
    token = await authenticate(session, payload.email, payload.password)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales inválidas",
        )

    set_session_cookie(response, token)
    return MessageResponse(message="Sesión iniciada correctamente")


@router.post("/register/request", response_model=MessageResponse, status_code=status.HTTP_202_ACCEPTED)
async def request_registration(
    payload: RegisterRequest,
    session: SessionDep,
) -> MessageResponse:
    await send_registration_token(session, payload.email)
    return MessageResponse(message="Si el email es válido, se enviará un token de registro")


@router.post("/register/complete", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
def complete_registration(
    payload: UserCreate,
    session: SessionDep,
) -> MessageResponse:
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
