"""Schemas de la configuración del sistema (singleton).

Los campos secretos existen SOLO en el schema de actualización (write-only) y el de
lectura expone únicamente metadata segura (configured, fechas, resultado del test).
``app_base_url`` y su verificación son de SOLO LECTURA aquí: los escribe el flujo de
verificación del backend, no el formulario.
"""

import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import Field, field_validator

from backend.app.schemas.base import ApiPatchSchema, ApiReadSchema


class SystemSettingsUpdate(ApiPatchSchema):
    """Campos EDITABLES de la política del sistema."""

    public_registration_enabled: Optional[bool] = Field(
        default=None,
        title="Registro público",
        description=(
            "Permitir el auto-registro por correo. Sólo tiene efecto si el "
            "despliegue lo permite (candado del entorno)."
        ),
        json_schema_extra={"ui": {"form": True, "widget": "switch"}},
    )
    institution_name: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=200,
        title="Nombre de la institución",
        description="Nombre de la institución para membretes y encabezados.",
        json_schema_extra={"ui": {"form": True, "widget": "text"}},
    )
    login_verification_mode: Optional[Literal["disabled", "code", "link"]] = Field(
        default=None,
        title="Verificación de inicio de sesión",
        description=(
            "Segundo paso por correo en cada login: código de un solo uso o enlace. "
            "Requiere transporte de correo utilizable. Los administradores con "
            "cobertura completa quedan exentos siempre (garantía anti-bloqueo)."
        ),
        json_schema_extra={
            "ui": {
                "form": True,
                "widget": "select",
                "options": [
                    {"value": "disabled", "label": "Deshabilitada (sólo contraseña)"},
                    {"value": "code", "label": "Código por correo"},
                    {"value": "link", "label": "Enlace por correo"},
                ],
            }
        },
    )
    customer_session_days: Optional[int] = Field(
        default=None,
        ge=1,
        le=365,
        title="Sesión del cliente (días)",
        description=(
            "Cuánto dura la sesión de un CLIENTE (usuario sin roles). La renovación "
            "deslizante la extiende con la actividad: un cliente que compra una vez "
            "al mes no vuelve a iniciar sesión. Vacío = default del despliegue."
        ),
        json_schema_extra={"ui": {"form": True, "widget": "number"}},
    )
    staff_session_minutes: Optional[int] = Field(
        default=None,
        ge=5,
        le=1440,
        title="Sesión del personal (minutos)",
        description=(
            "Cuánto dura la sesión de un usuario CON roles (panel/admin) sin "
            "actividad; con actividad se renueva sola. Vacío = default del despliegue."
        ),
        json_schema_extra={"ui": {"form": True, "widget": "number"}},
    )
    password_reset_enabled: Optional[bool] = Field(
        default=None,
        title="Recuperación de contraseña",
        description=(
            "Permitir restablecer contraseña por correo. AVISO: apagarla con el "
            "registro cerrado y un solo administrador puede dejar la instalación "
            "sin acceso (la salida es el seed del servidor)."
        ),
        json_schema_extra={"ui": {"form": True, "widget": "switch"}},
    )
    login_attempts_before_lock: Optional[int] = Field(
        default=None,
        ge=1,
        le=50,
        title="Intentos antes de bloquear",
        description=(
            "Intentos fallidos de inicio de sesión antes de bloquear la cuenta "
            "temporalmente. Vacío = default del despliegue."
        ),
        json_schema_extra={"ui": {"form": True, "widget": "number"}},
    )
    email_token_minutes: Optional[int] = Field(
        default=None,
        ge=5,
        le=1440,
        title="Vigencia de tokens por correo (minutos)",
        description=(
            "Cuánto duran los tokens enviados por correo (registro, recuperación de "
            "contraseña, verificación de login). Vacío = default del despliegue."
        ),
        json_schema_extra={"ui": {"form": True, "widget": "number"}},
    )
    application_timezone: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=64,
        title="Zona horaria de la instalación",
        description=(
            "Zona IANA (p. ej. America/Monterrey, America/Mexico_City, UTC): define "
            "los límites de día de los filtros de calendario. Vacío = default del "
            "despliegue. El cambio aplica en segundos, sin reiniciar."
        ),
        json_schema_extra={"ui": {"form": True, "widget": "text"}},
    )
    agent_ticket_ttl_seconds: Optional[int] = Field(
        default=None,
        ge=30,
        le=3600,
        title="Copiloto: vigencia del ticket (segundos)",
        description=(
            "Vigencia del ticket de conexión al copiloto (solo dura el handshake). "
            "Vacío = default del despliegue."
        ),
        json_schema_extra={"ui": {"form": True, "widget": "number"}},
    )
    agent_lease_ttl_seconds: Optional[int] = Field(
        default=None,
        ge=60,
        le=3600,
        title="Copiloto: vigencia del arriendo de credencial (segundos)",
        description=(
            "Vigencia del secreto de proveedor de IA arrendado por turno. Vacío = "
            "default del despliegue."
        ),
        json_schema_extra={"ui": {"form": True, "widget": "number"}},
    )

    audit_retention_days: Optional[int] = Field(
        default=None,
        ge=30,
        le=3650,
        title="Retención de auditoría (días)",
        description=(
            "La poda diaria elimina de la bitácora lo más antiguo que esta ventana. "
            "Vacío = conservar todo."
        ),
        json_schema_extra={"ui": {"form": True, "widget": "number"}},
    )
    notification_retention_days: Optional[int] = Field(
        default=None,
        ge=7,
        le=3650,
        title="Retención de notificaciones leídas (días)",
        description=(
            "La poda diaria elimina las notificaciones LEÍDAS más antiguas que esta "
            "ventana (las no leídas nunca se podan). Vacío = conservar todo."
        ),
        json_schema_extra={"ui": {"form": True, "widget": "number"}},
    )

    @field_validator("application_timezone")
    @classmethod
    def _validate_iana_timezone(cls, value: Optional[str]) -> Optional[str]:
        """La zona debe ser IANA válida: una zona rota rompería los filtros de fecha."""
        if value is None:
            return value
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        candidate = value.strip()
        if not candidate:
            return None
        try:
            ZoneInfo(candidate)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise ValueError(
                "Zona horaria inválida: usa un nombre IANA como America/Monterrey o UTC."
            ) from error
        return candidate
    email_mode: Optional[Literal["environment", "smtp", "resend"]] = Field(
        default=None,
        title="Transporte de correo",
        description=(
            "environment: SMTP del despliegue (Mailpit en desarrollo); smtp/resend: "
            "credenciales guardadas aquí (cifradas)."
        ),
        json_schema_extra={
            "ui": {
                "form": True,
                "widget": "select",
                "options": [
                    {"value": "environment", "label": "Del entorno (Mailpit en dev)"},
                    {"value": "smtp", "label": "SMTP propio"},
                    {"value": "resend", "label": "Resend"},
                ],
            }
        },
    )
    email_from_address: Optional[str] = Field(
        default=None,
        min_length=3,
        max_length=255,
        title="Remitente",
        description="Correo remitente (modos smtp/resend).",
        json_schema_extra={"ui": {"form": True, "widget": "email"}},
    )
    email_from_name: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=120,
        title="Nombre del remitente",
        json_schema_extra={"ui": {"form": True, "widget": "text"}},
    )
    email_smtp_host: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=255,
        title="Servidor SMTP",
        json_schema_extra={"ui": {"form": True, "widget": "text"}},
    )
    email_smtp_port: Optional[int] = Field(
        default=None,
        ge=1,
        le=65535,
        title="Puerto SMTP",
        json_schema_extra={"ui": {"form": True, "widget": "number"}},
    )
    email_smtp_username: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=255,
        title="Usuario SMTP",
        json_schema_extra={"ui": {"form": True, "widget": "text"}},
    )
    email_smtp_tls: Optional[bool] = Field(
        default=None,
        title="STARTTLS",
        json_schema_extra={"ui": {"form": True, "widget": "switch"}},
    )
    email_smtp_ssl: Optional[bool] = Field(
        default=None,
        title="SSL directo",
        json_schema_extra={"ui": {"form": True, "widget": "switch"}},
    )
    analytics_enabled: Optional[bool] = Field(
        default=None,
        title="Analítica del sitio (GA4)",
        description=(
            "Medir visitas y acciones del sitio público con Google Analytics 4. "
            "Requiere el ID de medición. El panel y el admin nunca se miden. "
            "Guía completa: docs/producto/puesta-en-marcha.md."
        ),
        json_schema_extra={"ui": {"form": True, "widget": "switch"}},
    )
    analytics_ga4_measurement_id: Optional[str] = Field(
        default=None,
        min_length=6,
        max_length=30,
        pattern=r"^G-[A-Z0-9]{4,26}$",
        title="ID de medición de GA4",
        description=(
            "Formato G-XXXXXXXXXX. En Google Analytics: Administración → Flujos de "
            "datos → tu flujo web → ID de medición. Es un identificador público."
        ),
        json_schema_extra={"ui": {"form": True, "widget": "text"}},
    )
    analytics_require_consent: Optional[bool] = Field(
        default=None,
        title="Exigir consentimiento de cookies",
        description=(
            "Mostrar un aviso de cookies analíticas: hasta que el visitante acepte "
            "no se carga Google Analytics ni se envía ningún evento."
        ),
        json_schema_extra={"ui": {"form": True, "widget": "switch"}},
    )
    analytics_debug_mode: Optional[bool] = Field(
        default=None,
        title="Modo de depuración (DebugView)",
        description=(
            "Enviar los eventos marcados para GA4 DebugView y así validar la "
            "medición. Apagar en operación normal."
        ),
        json_schema_extra={"ui": {"form": True, "widget": "switch"}},
    )
    google_login_enabled: Optional[bool] = Field(
        default=None,
        title="Inicio de sesión con Google",
        description=(
            "Muestra 'Continuar con Google' en el login. Requiere client ID y "
            "secret configurados. El alta de cuentas nuevas exige además el "
            "registro público habilitado."
        ),
        json_schema_extra={"ui": {"form": True, "widget": "switch"}},
    )
    google_auth_client_id: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=255,
        title="Client ID de Google (login)",
        json_schema_extra={"ui": {"form": True, "widget": "text"}},
    )
    # Secretos WRITE-ONLY: enviar un valor lo reemplaza, enviar null lo borra,
    # omitirlo lo conserva. JAMÁS existen en el schema de lectura.
    google_auth_client_secret: Optional[str] = Field(
        default=None,
        max_length=255,
        title="Client secret de Google (write-only)",
        description="Se guarda cifrado; nunca vuelve a mostrarse.",
        json_schema_extra={"ui": {"form": True, "widget": "text"}},
    )
    email_smtp_password: Optional[str] = Field(
        default=None,
        max_length=255,
        title="Contraseña SMTP (write-only)",
        description="Se guarda cifrada; nunca vuelve a mostrarse.",
        json_schema_extra={"ui": {"form": True, "widget": "text"}},
    )
    email_resend_api_key: Optional[str] = Field(
        default=None,
        max_length=255,
        title="API key de Resend (write-only)",
        description="Se guarda cifrada; nunca vuelve a mostrarse.",
        json_schema_extra={"ui": {"form": True, "widget": "text"}},
    )


class SystemSettingsRead(ApiReadSchema):
    """Estado completo y SEGURO de la configuración del sistema."""

    id: uuid.UUID
    public_registration_enabled: bool
    # Política efectiva (solo lectura; hoy coincide con la persistida).
    public_registration_effective: bool
    app_base_url: Optional[str] = None
    app_base_url_verified_at: Optional[datetime] = None
    institution_name: Optional[str] = None
    # Logo de la instalación (metadato; el binario JAMÁS se proyecta aquí).
    brand_logo_configured: bool
    brand_logo_updated_at: Optional[datetime] = None
    login_verification_mode: str
    google_login_enabled: bool
    google_auth_client_id: Optional[str] = None
    google_auth_client_secret_configured: bool
    password_reset_enabled: bool
    # Duración de sesión (None = default del despliegue); efectivos abajo.
    customer_session_days: Optional[int] = None
    staff_session_minutes: Optional[int] = None
    customer_session_days_effective: int
    staff_session_minutes_effective: int
    # Política operativa (None = default del despliegue); efectivos abajo.
    login_attempts_before_lock: Optional[int] = None
    email_token_minutes: Optional[int] = None
    application_timezone: Optional[str] = None
    agent_ticket_ttl_seconds: Optional[int] = None
    agent_lease_ttl_seconds: Optional[int] = None
    login_attempts_before_lock_effective: int
    email_token_minutes_effective: int
    application_timezone_effective: str
    agent_ticket_ttl_seconds_effective: int
    agent_lease_ttl_seconds_effective: int
    # Retención de datos (None = sin poda; no hay default de despliegue).
    audit_retention_days: Optional[int] = None
    notification_retention_days: Optional[int] = None
    # Correo: estado SEGURO (metadata; los secretos jamás se proyectan).
    email_mode: str
    email_from_address: Optional[str] = None
    email_from_name: Optional[str] = None
    email_smtp_host: Optional[str] = None
    email_smtp_port: Optional[int] = None
    email_smtp_username: Optional[str] = None
    email_smtp_tls: bool
    email_smtp_ssl: bool
    email_smtp_password_configured: bool
    email_resend_api_key_configured: bool
    email_last_test_at: Optional[datetime] = None
    email_last_test_status: Optional[str] = None
    email_last_test_error: Optional[str] = None
    # Derivado con la MISMA regla que usa el envío (None = transporte utilizable).
    email_transport_reason: Optional[str] = None
    # Analítica del sitio público (GA4; sin secretos involucrados).
    analytics_enabled: bool
    analytics_ga4_measurement_id: Optional[str] = None
    analytics_require_consent: bool
    analytics_debug_mode: bool
    environment: str
    created_at: datetime
    updated_at: Optional[datetime] = None
    updated_by: Optional[uuid.UUID] = None


class SystemSettingsListItem(ApiReadSchema):
    """Versión de listado del singleton (una fila)."""

    id: uuid.UUID
    institution_name: Optional[str] = Field(
        default=None, title="Institución", json_schema_extra={"ui": {"list": True}}
    )
    public_registration_enabled: bool = Field(
        title="Registro público", json_schema_extra={"ui": {"list": True}}
    )
    app_base_url: Optional[str] = Field(
        default=None, title="Dominio", json_schema_extra={"ui": {"list": True}}
    )
    updated_at: Optional[datetime] = Field(
        default=None, title="Actualizado", json_schema_extra={"ui": {"list": True}}
    )
    # Presente para el contrato de orden del query.
    created_at: datetime = Field(title="Creado")


class SendTestEmailRequest(ApiPatchSchema):
    """Cuerpo de la acción de correo de prueba (destinatario opcional: default el
    administrador que la ejecuta)."""

    recipient: Optional[str] = Field(
        default=None,
        min_length=3,
        max_length=255,
        title="Destinatario (opcional)",
        json_schema_extra={"ui": {"form": True, "widget": "email"}},
    )


class VerifyDomainRequest(ApiPatchSchema):
    """Cuerpo de la verificación de dominio (sin valor: se deriva del Origin)."""

    base_url: Optional[str] = Field(
        default=None,
        min_length=8,
        max_length=255,
        title="Dominio base (opcional)",
        description="https://tu-dominio; vacío = el dominio por el que navegas ahora.",
        json_schema_extra={"ui": {"form": True, "widget": "text"}},
    )


class PublicAnalyticsConfig(ApiReadSchema):
    """Config PÚBLICA de analítica para el sitio (GET /public/site/analytics).

    Apagada, solo devuelve ``enabled: false`` (sin ID ni opciones). El ID de
    medición de GA4 es público por diseño de Google; jamás viaja aquí ningún
    secreto (las claves de Measurement Protocol, si algún día existen, son
    exclusivas del servidor).
    """

    enabled: bool
    measurement_id: Optional[str] = None
    require_consent: bool = True
    debug_mode: bool = False


class SetupChecklistItemRead(ApiReadSchema):
    """Ítem del checklist de puesta en marcha (estado derivado)."""

    key: str
    title: str
    status: Literal["complete", "pending", "not_applicable"]
    detail: str


class SetupChecklistRead(ApiReadSchema):
    """Checklist derivado + si el administrador lo descartó."""

    items: list[SetupChecklistItemRead]
    dismissed: bool
    pending_count: int
    # Para el banner visual de entorno (dev/staging/producción).
    environment: str
