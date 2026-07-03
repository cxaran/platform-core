"""Schemas de la configuración del sistema (singleton).

Los campos secretos existen SOLO en el schema de actualización (write-only) y el de
lectura expone únicamente metadata segura (configured, fechas, resultado del test).
``app_base_url`` y su verificación son de SOLO LECTURA aquí: los escribe el flujo de
verificación del backend, no el formulario.
"""

import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import Field

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
    # Política efectiva y candado del despliegue (solo lectura, para que la UI
    # explique por qué el switch puede no tener efecto).
    registration_allowed_by_deployment: bool
    public_registration_effective: bool
    app_base_url: Optional[str] = None
    app_base_url_verified_at: Optional[datetime] = None
    institution_name: Optional[str] = None
    login_verification_mode: str
    google_login_enabled: bool
    google_auth_client_id: Optional[str] = None
    google_auth_client_secret_configured: bool
    password_reset_enabled: bool
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
