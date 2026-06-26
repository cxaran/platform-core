from typing import Literal
from pydantic_settings import BaseSettings
from pydantic import SecretStr, computed_field, model_validator, PostgresDsn
from pydantic_core import MultiHostUrl
from fastapi_mail import ConnectionConfig
from functools import lru_cache
from typing_extensions import Self

from backend.app.core.csrf import normalize_browser_origin


class Settings(BaseSettings):
    project_name: str = "FastAPI"
    environment: Literal["local", "staging", "production"] = "local"

    secret_key: SecretStr
    algorithm: str = "HS256"
    access_token_expire_minutes: int
    email_token_expire_minutes: int
    trys_before_lock: int

    # Allowlist explícita de orígenes de navegador confiables (CSV) para mutaciones
    # autenticadas por cookie. Dev: localhost. Producción: debe definirse por env.
    trusted_browser_origins: str = "http://localhost:3000"

    @computed_field
    @property
    def trusted_origins(self) -> frozenset[str]:
        normalized: set[str] = set()
        for raw in self.trusted_browser_origins.split(","):
            origin = normalize_browser_origin(raw.strip())
            if origin is not None:
                normalized.add(origin)
        return frozenset(normalized)

    @model_validator(mode="after")
    def _require_trusted_origins_in_production(self) -> Self:
        if self.environment == "production":
            origins = self.trusted_origins
            if not origins:
                raise ValueError(
                    "trusted_browser_origins debe definirse con orígenes HTTPS válidos en producción."
                )
            if any(not origin.startswith("https://") for origin in origins):
                raise ValueError(
                    "trusted_browser_origins debe contener únicamente orígenes HTTPS en producción."
                )
        return self

    redis_host: str
    redis_port: int
    redis_db: int

    # Zona horaria de aplicación (IANA) para la semántica de calendario de los filtros
    # de fecha. Default determinista UTC; dev/E2E pueden fijar p. ej. America/Monterrey.
    # Nunca se depende de la TZ del host, contenedor, navegador o PostgreSQL.
    application_timezone: str = "UTC"

    @model_validator(mode="after")
    def _validate_application_timezone(self) -> Self:
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        try:
            ZoneInfo(self.application_timezone)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise ValueError(
                f"application_timezone inválida (debe ser IANA ZoneInfo): {self.application_timezone!r}"
            ) from error
        return self

    # Rate limiting de rutas públicas de auth (ver security/rate_limit.py). Buckets
    # como "limit/window_seconds"; configurables por ambiente. ``fail_open`` solo se
    # respeta fuera de producción. ``trusted_proxies`` es CSV de IPs de proxy.
    rate_limit_enabled: bool = True
    rate_limit_fail_open: bool = False
    rate_limit_trusted_proxies: str = ""
    rate_limit_login_ip: str = "10/900"
    rate_limit_login_identity: str = "5/900"
    rate_limit_register_request_ip: str = "5/3600"
    rate_limit_register_request_identity: str = "3/3600"
    rate_limit_register_complete_ip: str = "10/900"
    rate_limit_forgot_ip: str = "5/3600"
    rate_limit_forgot_identity: str = "3/3600"
    rate_limit_reset_ip: str = "10/900"
    rate_limit_reset_token: str = "5/900"
    rate_limit_bootstrap_ip: str = "5/900"

    # Política pública de auth. Platform Core no asume signup público: el registro
    # está deshabilitado por defecto y debe habilitarse explícitamente por ambiente.
    # Al completarse un registro, el usuario queda ACTIVO pero SIN roles (sin acceso
    # hasta que un administrador le asigne uno) y SIN sesión automática.
    registration_enabled: bool = False
    password_reset_enabled: bool = True

    postgres_user: str
    postgres_password: str
    postgres_server: str
    postgres_port: int
    postgres_db: str

    @computed_field
    @property
    def postgres_dsn(self) -> PostgresDsn:
        return PostgresDsn(
            str(
                MultiHostUrl.build(
                    scheme="postgresql+psycopg2",
                    username=self.postgres_user,
                    password=self.postgres_password,
                    host=self.postgres_server,
                    port=self.postgres_port,
                    path=self.postgres_db,
                )
            )
        )

    smtp_host: str
    smtp_port: int
    smtp_user: str
    smtp_password: SecretStr
    smtp_from_email: str
    smtp_from_name: str
    smtp_tls: bool
    smtp_ssl: bool
    smtp_use_credentials: bool

    bootstrap_admin_email: str | None = None
    bootstrap_admin_password: SecretStr | None = None
    bootstrap_admin_name: str = "Admin"
    bootstrap_admin_last_name: str = "Platform"
    bootstrap_admin_role_name: str = "Administrador"
    bootstrap_user_role_name: str = "Usuario"
    bootstrap_setup_token: SecretStr | None = None

    @model_validator(mode="after")
    def _require_bootstrap_setup_token_in_production(self) -> Self:
        token = self.bootstrap_setup_token.get_secret_value().strip() if self.bootstrap_setup_token else ""
        if token and len(token) < 16:
            raise ValueError("bootstrap_setup_token debe tener al menos 16 caracteres.")
        if self.environment == "production" and not token:
            raise ValueError("bootstrap_setup_token es obligatorio en producción.")
        return self

    @computed_field
    @property
    def mail_config(self) -> ConnectionConfig:
        return ConnectionConfig(
            MAIL_USERNAME=self.smtp_user,
            MAIL_PASSWORD=self.smtp_password,
            MAIL_FROM=self.smtp_from_email,
            MAIL_FROM_NAME=self.smtp_from_name,
            MAIL_SERVER=self.smtp_host,
            MAIL_PORT=self.smtp_port,
            MAIL_STARTTLS=self.smtp_tls,
            MAIL_SSL_TLS=self.smtp_ssl,
            USE_CREDENTIALS=self.smtp_use_credentials,
            VALIDATE_CERTS=True,
        )

@lru_cache()
def get_settings() -> Settings:
    """
    Obtiene una instancia única y en caché de :class:`Settings`.
    """
    return Settings()  # pyright: ignore[reportCallIssue]


settings: Settings = get_settings()
