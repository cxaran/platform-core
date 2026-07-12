"""Renovación DESLIZANTE de la sesión (cookie httponly + JWT).

Cualquier request que llegue con un JWT de sesión válido y más allá de la
MITAD de su vida recibe una cookie renovada con el MISMO ttl original y el
mismo ``jti`` (la versión de token del usuario): la sesión vive mientras haya
actividad y muere tras el ttl completo de inactividad. Así el personal no es
expulsado a media jornada y el cliente que compra una vez al mes no vuelve a
iniciar sesión.

No consulta la base de datos: renovar el envoltorio de un ``jti`` ya revocado
(contraseña/correo cambiados, logout forzado) no revive nada — la validez
real la decide ``get_current_user`` contra ``User.token`` en cada request.
"""

from datetime import timedelta

import jwt
from fastapi import Request

from backend.app.core.settings import settings

from .auth import SESSION_COOKIE_KEY, set_session_cookie
from .security import create_access_token


async def sliding_session_middleware(request: Request, call_next):
    response = await call_next(request)
    token = request.cookies.get(SESSION_COOKIE_KEY)
    if not token:
        return response

    # Login/logout ya decidieron la cookie en esta respuesta: no pisarla.
    for header in response.headers.getlist("set-cookie"):
        if header.startswith(f"{SESSION_COOKIE_KEY}="):
            return response

    try:
        payload = jwt.decode(
            token,
            settings.secret_key.get_secret_value(),
            algorithms=[settings.algorithm],
        )
        issued_at = int(payload["iat"])
        expires_at = int(payload["exp"])
        subject = str(payload["sub"])
        jti = str(payload.get("jti") or "")
    except (jwt.InvalidTokenError, KeyError, ValueError):
        # Sin firma válida o ya expirado no hay nada que renovar.
        return response

    ttl_seconds = expires_at - issued_at
    if ttl_seconds <= 0:
        return response

    from backend.app.utils.utc_now import utc_now
    from datetime import timezone

    now_epoch = int(utc_now().replace(tzinfo=timezone.utc).timestamp())
    if now_epoch - issued_at <= ttl_seconds / 2:
        return response

    renewed = create_access_token(subject, jti, ttl=timedelta(seconds=ttl_seconds))
    set_session_cookie(response, renewed)
    return response
