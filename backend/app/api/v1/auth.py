from fastapi import APIRouter, HTTPException, Request, Response, status

from backend.app.api.resource_actions import api_error
from backend.app.auth.auth import authenticate, delete_session_cookie, set_session_cookie
from backend.app.auth.auth_dependencies import CurrentUser
from backend.app.auth.account_lock import unlock_user_by_token
from backend.app.auth.forgot_password import reset_password, send_password_reset_token
from backend.app.auth.register import create_user, send_registration_token
from backend.app.core.database import SessionDep
from backend.app.schemas.auth import (
    AuthPolicyRead,
    ForgotPasswordRequest,
    LoginRequest,
    LoginResponse,
    LoginVerifyRequest,
    MessageResponse,
    RegisterCompleteRequest,
    RegisterRequest,
    ResetPasswordRequest,
    UnlockAccountRequest,
)
from backend.app.schemas.user import SessionUser
from backend.app.security.rate_limit import (
    limit_forgot_password,
    limit_google_login,
    limit_login,
    limit_login_verify,
    limit_register_complete,
    limit_register_request,
    limit_reset_password,
)

from backend.app.services.system_settings_service import (
    is_password_reset_enabled,
    is_public_registration_enabled,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _require_enabled(enabled: bool, code: str, message: str) -> None:
    """403 estable cuando la función de auth está deshabilitada por política."""
    if not enabled:
        api_error(status.HTTP_403_FORBIDDEN, code, message)


@router.get("/policy", response_model=AuthPolicyRead)
def read_auth_policy(session: SessionDep) -> AuthPolicyRead:
    """Política pública de auth. El frontend la consume; no infiere de settings.

    El registro público es la política EFECTIVA: lo persistido en system_settings
    (editable por administradores) AND el candado del despliegue.
    """
    from backend.app.auth.google_login import is_google_login_enabled

    return AuthPolicyRead(
        registration_enabled=is_public_registration_enabled(session),
        password_reset_enabled=is_password_reset_enabled(session),
        google_login_enabled=is_google_login_enabled(session),
    )


@router.get("/me", response_model=SessionUser)
def read_current_user(current_user: CurrentUser) -> SessionUser:
    return current_user


@router.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    session: SessionDep,
) -> LoginResponse:
    limit_login(request, str(payload.email))
    token = await authenticate(session, payload.email, payload.password)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales inválidas",
        )

    # Segundo paso por correo (política en system_settings). SOLO tras validar la
    # contraseña (anti-enumeración intacta) y NUNCA para usuarios con cobertura
    # administrativa completa (garantía anti-bloqueo). Bearer no pasa por aquí:
    # el reto aplica únicamente a la creación de la sesión de navegador.
    from backend.app.auth.login_verification import (
        start_login_challenge,
        user_requires_verification,
    )
    from backend.app.auth.security import get_user_by_email
    from backend.app.services.system_settings_service import login_verification_mode

    mode = login_verification_mode(session)
    user = get_user_by_email(session, payload.email)
    if user is not None and user_requires_verification(session, user, mode):
        sent = await start_login_challenge(session, user, mode, response, request)
        if not sent:
            api_error(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "login_verification_email_failed",
                "No se pudo enviar el correo de verificación. Intenta más tarde.",
            )
        return LoginResponse(
            message=(
                "Te enviamos un código por correo para confirmar el inicio de sesión."
                if mode == "code"
                else "Te enviamos un enlace por correo para confirmar el inicio de sesión."
            ),
            verification_required=True,
            verification_mode=mode,
        )

    set_session_cookie(response, token)
    return LoginResponse(message="Sesión iniciada correctamente")


@router.post("/login/verify", response_model=LoginResponse)
def verify_login(
    payload: LoginVerifyRequest,
    request: Request,
    response: Response,
    session: SessionDep,
) -> LoginResponse:
    """Canjea el secreto del reto (código o token del enlace) por la sesión.

    Exige la cookie del reto del MISMO navegador que inició el login: un enlace
    reenviado a otro dispositivo no crea sesión ahí. Consumo único y tope de
    intentos por reto; el error es genérico (no distingue causa)."""
    from uuid import UUID

    from backend.app.auth.login_verification import (
        clear_challenge_cookie,
        verify_login_challenge,
    )
    from backend.app.auth.security import create_access_token
    from backend.app.models.user import User
    from backend.app.utils.utc_now import utc_now

    limit_login_verify(request)
    user_id = verify_login_challenge(request, payload.code)
    user = session.get(User, UUID(user_id)) if user_id else None
    if (
        user is None
        or not user.is_active
        or (user.locked_until and utc_now() < user.locked_until)
    ):
        api_error(
            status.HTTP_400_BAD_REQUEST,
            "login_verification_invalid",
            "Código inválido o expirado. Inicia sesión nuevamente.",
        )

    clear_challenge_cookie(response)
    from backend.app.auth.auth import session_ttl_for_user

    set_session_cookie(
        response,
        create_access_token(str(user.id), user.token, ttl=session_ttl_for_user(session, user)),
    )
    return LoginResponse(message="Sesión iniciada correctamente")


@router.get("/google/start")
def google_login_start(request: Request, session: SessionDep):
    """Arranca el OAuth con Google: 302 a la pantalla de consentimiento.

    404 genérico con la función deshabilitada (no revela si existe la política);
    el state viaja hasheado en Redis con consumo único y TTL corto."""
    from fastapi.responses import RedirectResponse

    from backend.app.auth.google_login import (
        GoogleLoginError,
        build_authorization_url,
        is_google_login_enabled,
    )

    limit_google_login(request)
    if not is_google_login_enabled(session):
        api_error(status.HTTP_404_NOT_FOUND, "not_found", "No disponible")
    try:
        url = build_authorization_url(session, request)
    except GoogleLoginError:
        api_error(status.HTTP_404_NOT_FOUND, "not_found", "No disponible")
    return RedirectResponse(url, status_code=status.HTTP_302_FOUND)


@router.get("/google/callback")
async def google_login_callback(
    request: Request,
    session: SessionDep,
    code: str = "",
    state: str = "",
):
    """Aterrizaje del OAuth: valida state+nonce+id_token y resuelve la cuenta.

    Éxito → cookie de sesión y 302 al inicio (SIN pasar por la verificación de
    login por correo: Google ya autenticó). Cualquier fallo → 302 a /login con
    un marcador genérico; la causa real queda sólo en los logs."""
    from fastapi.responses import RedirectResponse

    from backend.app.auth.google_login import (
        GoogleLoginError,
        _consume_state,
        exchange_code,
        is_google_login_enabled,
        oauth_base_url,
        resolve_user,
    )
    from backend.app.auth.security import create_access_token

    base = oauth_base_url(session, request)
    failure = RedirectResponse(
        f"{base}/login?error=google", status_code=status.HTTP_302_FOUND
    )
    if not is_google_login_enabled(session) or not code or not state:
        return failure
    nonce = _consume_state(state)
    if nonce is None:
        return failure
    try:
        profile = await exchange_code(session, request, code, nonce)
        user = resolve_user(session, profile)
    except GoogleLoginError as error:
        # Causa estable sólo en logs; el navegador recibe un marcador genérico.
        import logging

        logging.getLogger("backend.security").info("google login rejected: %s", error.code)
        return failure

    success = RedirectResponse(f"{base}/", status_code=status.HTTP_302_FOUND)
    from backend.app.auth.auth import session_ttl_for_user

    set_session_cookie(
        success,
        create_access_token(str(user.id), user.token, ttl=session_ttl_for_user(session, user)),
    )
    return success


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
    _require_enabled(
        is_public_registration_enabled(session),
        "registration_disabled",
        "El registro de cuentas no está disponible.",
    )
    limit_register_request(request, str(payload.email))
    await send_registration_token(session, payload.email)
    return MessageResponse(message="Si el email es válido, se enviará un token de registro")


@router.post("/register/complete", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
def complete_registration(
    payload: RegisterCompleteRequest,
    request: Request,
    session: SessionDep,
) -> MessageResponse:
    _require_enabled(
        is_public_registration_enabled(session),
        "registration_disabled",
        "El registro de cuentas no está disponible.",
    )
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
    _require_enabled(
        is_password_reset_enabled(session),
        "password_reset_disabled",
        "La recuperación de contraseña no está disponible.",
    )
    limit_forgot_password(request, str(payload.email))
    await send_password_reset_token(session, payload.email)
    return MessageResponse(message="Si el email es válido, se enviará un token de recuperación")


@router.post("/password/reset", response_model=MessageResponse)
def complete_password_reset(
    payload: ResetPasswordRequest,
    request: Request,
    session: SessionDep,
) -> MessageResponse:
    _require_enabled(
        is_password_reset_enabled(session),
        "password_reset_disabled",
        "La recuperación de contraseña no está disponible.",
    )
    limit_reset_password(request, payload.token)
    user = reset_password(session, payload.email, payload.token, payload.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Token de recuperación inválido o expirado",
        )
    return MessageResponse(message="Contraseña actualizada correctamente")
