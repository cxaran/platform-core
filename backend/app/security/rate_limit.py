"""Rate limiting reusable respaldado por Redis para rutas públicas de auth.

Servicio interno (no acoplado a cada ruta): expone un :class:`RateLimiter` con una
operación **atómica** (script Lua) que incrementa un contador y fija la expiración
solo al crear la clave, devolviendo contador y TTL restante. Evita la secuencia
insegura ``INCR`` → ``EXPIRE`` que dejaría claves sin vencimiento ante un fallo.

Privacidad: las claves nunca contienen emails, tokens ni IPs en claro; se usa un
fingerprint HMAC-SHA256 del identificador normalizado. Los logs solo deben registrar
``bucket``, permitido/bloqueado y ``retry_after`` (nunca el identificador).

Política de fallo: en producción, si Redis no está disponible para una ruta pública
sensible, se falla **cerrado** (``RateLimitUnavailable`` → 503). En dev/test se puede
habilitar ``fail_open`` explícito para reproducibilidad, nunca implícito en producción.
"""

import hashlib
import hmac
from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol

from fastapi import HTTPException, status
from redis.exceptions import RedisError
from starlette.requests import Request

from backend.app.core.settings import settings
from backend.app.schemas.error import ErrorResponse

KEY_PREFIX = "platform-core:rate-limit:v1"

# Incremento atómico con expiración solo al crear la clave. Devuelve {contador, ttl_ms}.
_RATE_LIMIT_LUA = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return {current, redis.call('PTTL', KEYS[1])}
"""

RATE_LIMITED = "rate_limited"
RATE_LIMIT_UNAVAILABLE = "rate_limit_unavailable"


class RateLimitUnavailable(Exception):
    """Redis no disponible y la política es fallar cerrado."""

    code = RATE_LIMIT_UNAVAILABLE


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    retry_after: int  # segundos; 0 cuando está permitido


@dataclass(frozen=True)
class BucketPolicy:
    limit: int
    window_seconds: int


class _ScriptRunner(Protocol):
    def __call__(self, *, keys: list[str], args: list[int]) -> list[int]: ...


class _RedisLike(Protocol):
    def register_script(self, script: str) -> _ScriptRunner: ...


def parse_policy(raw: str) -> BucketPolicy:
    """Parsea ``"limit/window_seconds"`` (p. ej. ``"10/900"``)."""
    try:
        limit_str, window_str = raw.split("/", 1)
        policy = BucketPolicy(limit=int(limit_str), window_seconds=int(window_str))
    except (ValueError, AttributeError) as error:
        raise ValueError(f"Política de rate limit inválida: {raw!r}") from error
    if policy.limit < 1 or policy.window_seconds < 1:
        raise ValueError(f"Política de rate limit fuera de rango: {raw!r}")
    return policy


def fingerprint(secret: str, value: str) -> str:
    """Hash HMAC-SHA256 truncado del identificador; nunca el valor en claro."""
    digest = hmac.new(secret.encode("utf-8"), value.encode("utf-8"), hashlib.sha256)
    return digest.hexdigest()[:32]


class RateLimiter:
    def __init__(
        self,
        redis: _RedisLike,
        *,
        secret: str,
        namespace: str = KEY_PREFIX,
        fail_open: bool = False,
    ) -> None:
        self._secret = secret
        self._namespace = namespace
        self._fail_open = fail_open
        self._script = redis.register_script(_RATE_LIMIT_LUA)

    def key(self, bucket: str, identifier: str, window_seconds: int) -> str:
        fp = fingerprint(self._secret, f"{bucket}:{identifier}")
        return f"{self._namespace}:{bucket}:{fp}:{window_seconds}"

    def check(
        self,
        bucket: str,
        identifier: str,
        *,
        limit: int,
        window_seconds: int,
    ) -> RateLimitResult:
        key = self.key(bucket, identifier, window_seconds)
        try:
            count_raw, ttl_raw = self._script(keys=[key], args=[window_seconds * 1000])
        except RedisError as error:
            if self._fail_open:
                return RateLimitResult(allowed=True, retry_after=0)
            raise RateLimitUnavailable() from error
        count = int(count_raw)  # type: ignore[arg-type]
        ttl_ms = int(ttl_raw)  # type: ignore[arg-type]
        if count > limit:
            # ceil(ttl_ms/1000); si TTL no disponible, se usa la ventana completa.
            retry_after = -(-ttl_ms // 1000) if ttl_ms > 0 else window_seconds
            return RateLimitResult(allowed=False, retry_after=max(1, retry_after))
        return RateLimitResult(allowed=True, retry_after=0)


def normalize_identity(value: str) -> str:
    """Normaliza un identificador (p. ej. email) para una clave estable."""
    return value.strip().casefold()


def resolve_client_ip(request: Request, trusted_proxies: frozenset[str]) -> str:
    """IP del cliente. Solo se interpretan headers de proxy si el par directo es un
    proxy explícitamente confiable; nunca se permite que un cliente externo falsifique
    su IP con headers."""
    peer = request.client.host if request.client else "unknown"
    if peer in trusted_proxies:
        real = request.headers.get("x-real-ip")
        if real and real.strip():
            return real.strip()
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded and forwarded.strip():
            # El último salto lo agrega el proxy confiable (la IP real del cliente).
            return forwarded.split(",")[-1].strip()
    return peer


# --- Capa de aplicación: políticas desde Settings y enforcement en rutas ---


@lru_cache(maxsize=1)
def _policies() -> dict[str, BucketPolicy]:
    return {
        "login_ip": parse_policy(settings.rate_limit_login_ip),
        "login_identity": parse_policy(settings.rate_limit_login_identity),
        "register_request_ip": parse_policy(settings.rate_limit_register_request_ip),
        "register_request_identity": parse_policy(settings.rate_limit_register_request_identity),
        "register_complete_ip": parse_policy(settings.rate_limit_register_complete_ip),
        "forgot_ip": parse_policy(settings.rate_limit_forgot_ip),
        "forgot_identity": parse_policy(settings.rate_limit_forgot_identity),
        "reset_ip": parse_policy(settings.rate_limit_reset_ip),
        "reset_token": parse_policy(settings.rate_limit_reset_token),
        "bootstrap_ip": parse_policy(settings.rate_limit_bootstrap_ip),
        "login_verify_ip": parse_policy(settings.rate_limit_login_verify_ip),
    }


@lru_cache(maxsize=1)
def _trusted_proxies() -> frozenset[str]:
    return frozenset(
        item.strip() for item in settings.rate_limit_trusted_proxies.split(",") if item.strip()
    )


@lru_cache(maxsize=1)
def get_rate_limiter() -> RateLimiter:
    from backend.app.core.redis import redis_client

    # ``fail_open`` solo se respeta fuera de producción: en producción se falla cerrado.
    fail_open = settings.rate_limit_fail_open and settings.environment != "production"
    return RateLimiter(
        redis_client,
        secret=settings.secret_key.get_secret_value(),
        fail_open=fail_open,
    )


def client_ip(request: Request) -> str:
    return resolve_client_ip(request, _trusted_proxies())


def _raise_limited(retry_after: int) -> None:
    body = ErrorResponse(code=RATE_LIMITED, message="Demasiados intentos. Inténtalo más tarde.")
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=body.model_dump(exclude_none=True),
        headers={"Retry-After": str(retry_after)},
    )


def _raise_unavailable() -> None:
    body = ErrorResponse(
        code=RATE_LIMIT_UNAVAILABLE,
        message="Servicio temporalmente no disponible. Inténtalo más tarde.",
    )
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=body.model_dump(exclude_none=True),
    )


def enforce(request: Request, *checks: tuple[str, str]) -> None:
    """Aplica de forma acumulativa los buckets ``(nombre, identificador)``.

    Debe llamarse **antes** de operaciones costosas (hash de password, consulta de
    usuario, envío de correo, creación de cuenta). No revela qué bucket bloqueó."""
    if not settings.rate_limit_enabled:
        return
    limiter = get_rate_limiter()
    policies = _policies()
    for bucket, identifier in checks:
        policy = policies[bucket]
        try:
            result = limiter.check(
                bucket, identifier, limit=policy.limit, window_seconds=policy.window_seconds
            )
        except RateLimitUnavailable:
            _raise_unavailable()
            return
        if not result.allowed:
            _raise_limited(result.retry_after)


def limit_login(request: Request, email: str) -> None:
    enforce(
        request,
        ("login_ip", client_ip(request)),
        ("login_identity", normalize_identity(email)),
    )


def limit_login_verify(request: Request) -> None:
    enforce(request, ("login_verify_ip", client_ip(request)))


def limit_register_request(request: Request, email: str) -> None:
    enforce(
        request,
        ("register_request_ip", client_ip(request)),
        ("register_request_identity", normalize_identity(email)),
    )


def limit_register_complete(request: Request) -> None:
    enforce(request, ("register_complete_ip", client_ip(request)))


def limit_forgot_password(request: Request, email: str) -> None:
    enforce(
        request,
        ("forgot_ip", client_ip(request)),
        ("forgot_identity", normalize_identity(email)),
    )


def limit_reset_password(request: Request, token: str) -> None:
    # El token nunca aparece en la clave: se usa su fingerprint dentro de ``check``.
    enforce(
        request,
        ("reset_ip", client_ip(request)),
        ("reset_token", token),
    )


def limit_bootstrap_initialize(request: Request) -> None:
    enforce(request, ("bootstrap_ip", client_ip(request)))
