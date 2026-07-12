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

    # Sesión del CLIENTE (usuario sin roles): larga, en días — un usuario final que
    # entra una vez al mes no debe volver a iniciar sesión. El personal (con roles
    # RBAC) conserva la sesión corta de access_token_expire_minutes. Ambas se
    # extienden con la renovación deslizante mientras haya actividad; rotar
    # User.token (contraseña/correo/forzar logout) las mata al instante.
    customer_session_expire_days: int = 90

    # Allowlist de orígenes de navegador confiables (CSV) para mutaciones
    # autenticadas por cookie. OPCIONAL: el dominio de la instalación se captura en
    # el asistente de bootstrap (token-gated) y se persiste en system_settings —
    # el guard lo carga de la base en runtime. Esta variable queda como override
    # ADITIVO de despliegue/emergencia (p. ej. recuperar una instalación con un
    # dominio mal guardado). Sin definir: localhost en dev, vacío en producción.
    trusted_browser_origins: str | None = None

    @computed_field
    @property
    def trusted_origins(self) -> frozenset[str]:
        raw_csv = self.trusted_browser_origins
        if raw_csv is None:
            raw_csv = "" if self.environment == "production" else "http://localhost:3000"
        normalized: set[str] = set()
        for raw in raw_csv.split(","):
            origin = normalize_browser_origin(raw.strip())
            if origin is not None:
                normalized.add(origin)
        return frozenset(normalized)

    @model_validator(mode="after")
    def _require_https_trusted_origins_in_production(self) -> Self:
        # Producción ya no EXIGE la variable (el dominio vive en system_settings,
        # declarado en el bootstrap); pero si se define, solo se aceptan orígenes
        # HTTPS — un origen http confiable anularía la protección del guard.
        if self.environment == "production":
            if any(not origin.startswith("https://") for origin in self.trusted_origins):
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
    rate_limit_login_verify_ip: str = "10/900"
    rate_limit_google_login_ip: str = "10/900"

    # Política pública de auth. Platform Core no asume signup público: el registro
    # está deshabilitado por defecto y debe habilitarse explícitamente.
    # Al completarse un registro, el usuario queda ACTIVO pero SIN roles (sin acceso
    # hasta que un administrador le asigne uno) y SIN sesión automática.
    # (registration_enabled/password_reset_enabled se retiraron de Settings: la
    # política vive en system_settings —editable por administradores— y la migración
    # de siembra importó el valor del entorno una única vez. El antiguo gate
    # REGISTRATION_ALLOWED del entorno se retiró: system_settings es la única
    # fuente de verdad del registro público.)

    # Respaldos cifrados hacia Google Drive (una sola cuenta, scope drive.file). El
    # horario/retención EDITABLES viven en la tabla backup_settings (no aquí); estos
    # settings son el interruptor global y los secretos de despliegue. Apagado por
    # defecto: la API y el worker arrancan igual que antes sin configurar nada.
    # KILL-SWITCH del tick de respaldos (no un paso de instalación): el interruptor
    # real es backup_settings.enabled, editable en la UI. Apagar esto detiene el
    # procesamiento aunque la política diga lo contrario (emergencias).
    backups_enabled: bool = True
    # DEPRECADA como política: backup_settings.explorer_enabled (DB, editable) es la
    # fuente de verdad; la migración de siembra importó este valor una única vez.
    backup_explorer_enabled: bool = False
    backup_temp_dir: str = "/tmp/platform-core-backups"
    backup_run_lease_minutes: int = 120
    backup_max_attempts: int = 3
    # (Las credenciales OAuth de Google Drive se retiraron del entorno: viven
    # únicamente en backup_settings — client ID en claro, client secret cifrado
    # write-only, capturados en la UI — y el redirect URI se deriva del dominio
    # base verificado, igual que el login con Google en system_settings.)

    # Clave Fernet que cifra en reposo secretos guardados en la base (p. ej. el
    # refresh token de Google Drive). Legada: la CLAVE MAESTRA nueva es
    # ``app_encryption_key``; esta se conserva en la cadena de descifrado para no
    # romper despliegues previos.
    backup_token_encryption_key: SecretStr | None = None

    # CLAVE MAESTRA ÚNICA de cifrado de secretos de configuración (Fernet). Escribe
    # todo lo nuevo; las claves legadas (backup_token) siguen descifrando material
    # viejo (re-cifrado perezoso al reescribir). Generar:
    #   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    app_encryption_key: SecretStr | None = None

    # --- Agent Gateway (copiloto agéntico) ---
    # Secreto HS256 con el que FastAPI firma el ticket de conexión efímero que el
    # navegador presenta al Agent Gateway. El Gateway verifica con este mismo secreto
    # (var GATEWAY_AGENT_TICKET_SECRET). Sin default: fail-closed.
    agent_gateway_ticket_signing_secret: SecretStr = SecretStr("")
    # TTL del ticket de conexión (segundos). Corto: solo debe durar el handshake.
    agent_gateway_ticket_ttl_seconds: int = 120
    # Secreto compartido server-to-server para el puente interno de arriendo de
    # credencial (header X-Internal-Auth). None = puente deshabilitado (503).
    agent_gateway_internal_secret: SecretStr | None = None
    # TTL del secreto de proveedor arrendado por turn (segundos).
    agent_gateway_lease_ttl_seconds: int = 300

    @model_validator(mode="after")
    def _require_encryption_key_in_production(self) -> Self:
        if self.environment == "production" and not any(
            key is not None
            for key in (
                self.app_encryption_key,
                self.backup_token_encryption_key,
            )
        ):
            raise ValueError(
                "Producción requiere APP_ENCRYPTION_KEY (clave Fernet) para cifrar "
                "secretos de configuración en reposo."
            )
        return self

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

    # Transporte de correo del modo "entorno" (el modo real se elige en la UI:
    # entorno/SMTP/Resend, con secretos cifrados en system_settings). OPCIONALES
    # con defaults vacíos: una instalación 100% automática arranca sin proveedor
    # de correo y lo configura después desde la UI; en producción el modo
    # "entorno" exige un SMTP real al usarse, no al importar.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: SecretStr = SecretStr("")
    smtp_from_email: str = ""
    smtp_from_name: str = "Platform Core"
    smtp_tls: bool = True
    smtp_ssl: bool = False
    smtp_use_credentials: bool = True

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
