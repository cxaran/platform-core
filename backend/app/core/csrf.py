"""Protección CSRF de mutaciones autenticadas por cookie (Fetch Metadata).

El navegador anexa la cookie ``session_token`` automáticamente a toda solicitud
hacia este backend, la origine quien la origine; ahí vive el riesgo de CSRF. El
header ``Sec-Fetch-Site`` —emitido por el propio navegador, una página no puede
falsificarlo— declara la relación entre el sitio que originó la solicitud y este.
La plataforma se sirve completa detrás de un mismo origen (nginx), así que una
mutación (POST/PUT/PATCH/DELETE) con cookie de sesión que el navegador declara
``cross-site`` solo puede ser un intento de forja y se rechaza con 403.

Sin allowlist ni configuración. Pasan sin comprobación: los métodos seguros, las
solicitudes sin cookie de sesión (no hay sesión que secuestrar; el endpoint
igualmente exigirá credenciales) y las que no traen el header (clientes
no-navegador con Bearer; los navegadores antiguos sin fetch metadata quedan
cubiertos por ``SameSite=Lax`` en la cookie). Defensa en profundidad: SameSite es
el cinturón que hace cumplir el navegador; este guard, el airbag del servidor.
"""

from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from backend.app.schemas.error import ErrorResponse

_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def _forbidden() -> JSONResponse:
    body = ErrorResponse(code="csrf_origin_invalid", message="Solicitud no disponible.")
    return JSONResponse(status_code=403, content=body.model_dump(exclude_none=True))


class CrossSiteMutationGuardMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:  # type: ignore[no-untyped-def]
        if request.method in _SAFE_METHODS:
            return await call_next(request)

        # Import diferido: auth.auth arrastra settings/redis, que exigen entorno
        # completo; este módulo debe poder importarse sin él (p. ej. tooling).
        from backend.app.auth.auth import SESSION_COOKIE_KEY

        if SESSION_COOKIE_KEY not in request.cookies:
            return await call_next(request)
        if request.headers.get("sec-fetch-site", "").strip().lower() == "cross-site":
            return _forbidden()
        return await call_next(request)
