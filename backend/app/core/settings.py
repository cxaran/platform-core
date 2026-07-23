"""Configuración de despliegue: TODO se lee de variables de entorno (Pydantic).

Aquí vive solo lo que pertenece al despliegue — conexiones, secretos y
interruptores que la UI no puede cambiar. La política editable en runtime
(registro público, correo saliente, dominio, duraciones, retención…) vive en la
base de datos: ``system_settings`` (ver services/system_settings_service.py).

No hay defaults para secretos ni conexiones: sin un entorno completo el módulo
falla al importar (fail-fast). El set completo de variables está documentado en
``compose.dev.yml`` y en los tests.
"""

from functools import lru_cache
from typing import Literal

from fastapi_mail import ConnectionConfig
from pydantic import PostgresDsn, SecretStr, computed_field, model_validator
from pydantic_core import MultiHostUrl
from pydantic_settings import BaseSettings
from typing_extensions import Self


class Settings(BaseSettings):
    # ------------------------------------------------------------- aplicación ----
    project_name: str = "Platform Core"
    environment: Literal["local", "staging", "production"] = "local"

    # Zona horaria (IANA) para la semántica de calendario de los filtros de fecha.
    # Default determinista UTC; nunca se depende de la TZ del host, del contenedor,
    # del navegador ni de PostgreSQL.
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

    # -------------------------------------------------- sesiones y contraseñas ----
    secret_key: SecretStr  # firma HS256 de los JWT de sesión y del reto de dominio
    algorithm: str = "HS256"
    # Duración de toda sesión; la renovación deslizante la extiende con actividad.
    access_token_expire_minutes: int
    # TTL de los tokens enviados por correo (registro, recuperación, desbloqueo).
    email_token_expire_minutes: int
    # Intentos de login fallidos antes del bloqueo con backoff exponencial.
    trys_before_lock: int

    # -------------------------------------------------------------- conexiones ----
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

    redis_host: str
    redis_port: int
    redis_db: int

    # ---------------------------------------------------- correo (modo entorno) ----
    # Transporte del modo "entorno"; el modo real se elige en la UI (entorno/SMTP/
    # Resend, con secretos cifrados en system_settings). Defaults vacíos: una
    # instalación arranca sin proveedor de correo y lo configura después.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: SecretStr = SecretStr("")
    smtp_from_email: str = ""
    smtp_from_name: str = "Platform Core"
    smtp_tls: bool = True
    smtp_ssl: bool = False
    smtp_use_credentials: bool = True

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

    # ------------------------------------------------------------ rate limiting ----
    # Rutas públicas de auth (ver security/rate_limit.py). Buckets con formato
    # "límite/ventana_segundos". ``fail_open`` solo se respeta fuera de producción;
    # ``trusted_proxies`` es un CSV de IPs de proxy confiables.
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
    rate_limit_login_verify_ip: str = "10/900"
    rate_limit_google_login_ip: str = "10/900"

    # ----------------------------------------------- cifrado de secretos en BD ----
    # Clave maestra Fernet ÚNICA: cifra en reposo los secretos guardados en la base
    # (SMTP, Resend, OAuth de Drive…). Obligatoria en producción. Generar con:
    #   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    app_encryption_key: SecretStr | None = None

    @model_validator(mode="after")
    def _require_encryption_key_in_production(self) -> Self:
        if self.environment == "production" and self.app_encryption_key is None:
            raise ValueError(
                "Producción requiere APP_ENCRYPTION_KEY (clave Fernet) para cifrar "
                "secretos de configuración en reposo."
            )
        return self

    # ---------------------------------------------------------------- respaldos ----
    # Kill-switch del tick de respaldos (emergencias): apagarlo detiene el
    # procesamiento aunque la política lo pida. El interruptor normal es
    # backup_settings.enabled, editable en la UI; horario y retención también
    # viven en esa tabla.
    backups_enabled: bool = True
    # DEPRECADA como política: backup_settings.explorer_enabled (UI) es la fuente
    # de verdad; la migración de siembra importó este valor una única vez.
    backup_explorer_enabled: bool = False
    backup_temp_dir: str = "/tmp/platform-core-backups"
    backup_run_lease_minutes: int = 120
    backup_max_attempts: int = 3

    # ---------------------------------------------------------------- bootstrap ----
    # Token que protege el asistente de instalación (/setup). Un solo uso: el
    # bootstrap se cierra permanentemente al completarse.
    bootstrap_setup_token: SecretStr | None = None
    # Seed CLI operativo (desarrollo/recuperación): crea el admin sin pasar por
    # el asistente. Nunca se ejecuta automáticamente ni se expone por HTTP.
    bootstrap_admin_email: str | None = None
    bootstrap_admin_password: SecretStr | None = None
    bootstrap_admin_name: str = "Admin"
    bootstrap_admin_last_name: str = "Platform"
    bootstrap_admin_role_name: str = "Administrador"
    bootstrap_user_role_name: str = "Usuario"

    @model_validator(mode="after")
    def _require_bootstrap_setup_token_in_production(self) -> Self:
        token = self.bootstrap_setup_token.get_secret_value().strip() if self.bootstrap_setup_token else ""
        if token and len(token) < 16:
            raise ValueError("bootstrap_setup_token debe tener al menos 16 caracteres.")
        if self.environment == "production" and not token:
            raise ValueError("bootstrap_setup_token es obligatorio en producción.")
        return self

    # ---------------------------------------------- Agent Gateway (copiloto IA) ----
    # Secreto HS256 con el que FastAPI firma el ticket de conexión efímero que el
    # navegador presenta al gateway (= GATEWAY_AGENT_TICKET_SECRET). Sin default
    # utilizable: vacío = fail-closed.
    agent_gateway_ticket_signing_secret: SecretStr = SecretStr("")
    agent_gateway_ticket_ttl_seconds: int = 120  # solo debe durar el handshake
    # Secreto server-to-server del puente de arriendo de credencial (header
    # X-Internal-Auth; = GATEWAY_BACKEND_INTERNAL_SECRET). None = puente 503.
    agent_gateway_internal_secret: SecretStr | None = None
    agent_gateway_lease_ttl_seconds: int = 300  # TTL de la credencial por turno

    # Conexión de cuenta ChatGPT Plus/Codex por OAuth PKCE (browser-callback, NO
    # device-code). El perfil {access, refresh, expires, account_id} se guarda
    # CIFRADO y el arriendo entrega el access token vigente al proveedor
    # ``openai_codex`` del gateway. ``client_id`` lo aporta el operador; sin él,
    # los endpoints responden 503. ``redirect_uri`` es opcional: sin definir se
    # deriva de la URL declarada de la instalación (/account/oauth/callback).
    openai_oauth_client_id: str | None = None
    openai_oauth_authorize_url: str = "https://auth.openai.com/oauth/authorize"
    openai_oauth_token_url: str = "https://auth.openai.com/oauth/token"
    openai_oauth_redirect_uri: str | None = None
    openai_oauth_scope: str = "openid profile email offline_access"
    # Margen (segundos) antes del vencimiento para refrescar el access token de
    # forma proactiva en el arriendo (el Gateway nunca recibe un token al límite).
    openai_oauth_refresh_skew_seconds: int = 60


@lru_cache()
def get_settings() -> Settings:
    """Instancia única y cacheada de :class:`Settings`."""
    return Settings()  # pyright: ignore[reportCallIssue]


settings: Settings = get_settings()
