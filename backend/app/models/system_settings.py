"""Configuración del SISTEMA (singleton editable por administradores).

Hogar persistente de la política de plataforma que antes vivía sólo en variables de
entorno: el backend es la fuente de verdad y los cambios quedan auditados (quién y
cuándo). Cubre registro público, dominio base verificado, nombre institucional y
correo saliente. Las fases siguientes añaden columnas TIPADAS por dominio; nunca un
key-value genérico.

Patrón singleton: una fila garantizada por CHECK sobre ``singleton_key``. La fila se
siembra en la migración (importando el valor vigente de ``REGISTRATION_ENABLED`` una
sola vez) y en el bootstrap HTTP se actualiza con las decisiones del asistente.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.models.base import Base


class SystemSettings(Base):
    """Fila ÚNICA de configuración del sistema (política editable en runtime)."""

    __tablename__ = "system_settings"
    __table_args__ = (
        CheckConstraint("singleton_key = true", name="system_settings_singleton"),
        CheckConstraint(
            "customer_session_days IS NULL OR customer_session_days > 0",
            name="system_settings_customer_session_days_positive",
        ),
        CheckConstraint(
            "staff_session_minutes IS NULL OR staff_session_minutes > 0",
            name="system_settings_staff_session_minutes_positive",
        ),
        CheckConstraint(
            "email_mode in ('environment', 'smtp', 'resend')",
            name="system_settings_email_mode",
        ),
        CheckConstraint(
            "login_attempts_before_lock IS NULL OR login_attempts_before_lock > 0",
            name="system_settings_login_attempts_positive",
        ),
        CheckConstraint(
            "email_token_minutes IS NULL OR email_token_minutes > 0",
            name="system_settings_email_token_minutes_positive",
        ),
        CheckConstraint(
            "agent_ticket_ttl_seconds IS NULL OR agent_ticket_ttl_seconds > 0",
            name="system_settings_agent_ticket_ttl_positive",
        ),
        CheckConstraint(
            "agent_lease_ttl_seconds IS NULL OR agent_lease_ttl_seconds > 0",
            name="system_settings_agent_lease_ttl_positive",
        ),
        CheckConstraint(
            "audit_retention_days IS NULL OR audit_retention_days > 0",
            name="system_settings_audit_retention_positive",
        ),
        CheckConstraint(
            "notification_retention_days IS NULL OR notification_retention_days > 0",
            name="system_settings_notification_retention_positive",
        ),
        CheckConstraint(
            "login_verification_mode in ('disabled', 'code', 'link')",
            name="system_settings_login_verification_mode",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    singleton_key: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        unique=True,
        comment="Siempre true: fuerza una sola fila de configuración del sistema.",
    )

    public_registration_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment=(
            "Política de registro público (auto-registro por correo). Única fuente "
            "de verdad: no existe gate de entorno."
        ),
    )

    app_base_url: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment=(
            "Dominio base confirmado de la instalación (https://…), usado para "
            "calcular redirect URIs. Se AÑADE a los orígenes confiables del entorno, "
            "nunca los reemplaza."
        ),
    )
    app_base_url_verified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        nullable=True,
        comment="Momento (UTC) en que el dominio base se verificó; lo escribe el backend.",
    )

    institution_name: Mapped[Optional[str]] = mapped_column(
        String(200),
        nullable=True,
        comment="Nombre de la institución (membrete y encabezados).",
    )

    login_verification_mode: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
        default="disabled",
        comment=(
            "Segundo paso de login verificado por correo: disabled, code (código de "
            "un solo uso) o link (enlace). Los usuarios con cobertura administrativa "
            "completa quedan exentos SIEMPRE (garantía anti-bloqueo); los clientes "
            "Bearer no re-verifican."
        ),
    )

    password_reset_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        comment=(
            "Recuperación de contraseña por correo. Sin candado de despliegue (bajo "
            "riesgo); apagarla con registro cerrado y un solo admin puede dejar la "
            "instalación sin acceso (salida: seed CLI)."
        ),
    )

    # -- Duración de sesión (política editable; NULL = default del despliegue) ------
    customer_session_days: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment=(
            "Días de sesión del CLIENTE (usuario sin roles). NULL = usar el default "
            "del despliegue (CUSTOMER_SESSION_EXPIRE_DAYS). La renovación deslizante "
            "extiende la sesión con la actividad."
        ),
    )
    staff_session_minutes: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment=(
            "Minutos de sesión del PERSONAL (usuario con roles). NULL = usar el "
            "default del despliegue (ACCESS_TOKEN_EXPIRE_MINUTES)."
        ),
    )

    # -- Seguridad de cuentas (política editable; NULL = default del despliegue) ----
    login_attempts_before_lock: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment=(
            "Intentos fallidos de login antes de bloquear la cuenta. NULL = usar el "
            "default del despliegue (TRYS_BEFORE_LOCK)."
        ),
    )
    email_token_minutes: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment=(
            "Minutos de vigencia de los tokens enviados por correo (registro, "
            "recuperación, verificación de login). NULL = usar el default del "
            "despliegue (EMAIL_TOKEN_EXPIRE_MINUTES)."
        ),
    )

    # -- Retención de datos operativos (poda diaria; NULL = conservar todo) ---------
    audit_retention_days: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment=(
            "Días a conservar en la bitácora de auditoría; la poda diaria elimina lo "
            "más antiguo. NULL = sin poda (crecimiento sin límite)."
        ),
    )
    notification_retention_days: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment=(
            "Días a conservar las notificaciones LEÍDAS; la poda diaria elimina las "
            "leídas más antiguas (las no leídas nunca se podan). NULL = sin poda."
        ),
    )

    # -- Zona horaria de la instalación (semántica de calendario de filtros) --------
    application_timezone: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
        comment=(
            "Zona horaria IANA de la instalación (p. ej. America/Monterrey): define "
            "los límites de día de los filtros de calendario. NULL = default del "
            "despliegue (APPLICATION_TIMEZONE). El cambio aplica en segundos (caché "
            "corto por proceso)."
        ),
    )

    # -- Copiloto agéntico (TTLs operativos; NULL = default del despliegue) ---------
    agent_ticket_ttl_seconds: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment=(
            "Segundos de vigencia del ticket de conexión al Agent Gateway. NULL = "
            "default del despliegue (AGENT_GATEWAY_TICKET_TTL_SECONDS)."
        ),
    )
    agent_lease_ttl_seconds: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
        comment=(
            "Segundos de vigencia del arriendo de credencial de proveedor de IA por "
            "turno. NULL = default del despliegue (AGENT_GATEWAY_LEASE_TTL_SECONDS)."
        ),
    )

    # -- Logo de la instalación (marca de la PWA/manifest; binario en la BD como el
    # resto de la configuración: viaja con los respaldos). Solo imágenes RASTER
    # verificadas con Pillow al subir (SVG bloqueado: nunca se sirve markup).
    brand_logo_content: Mapped[Optional[bytes]] = mapped_column(
        LargeBinary,
        nullable=True,
        comment="Logo de la instalación (binario raster verificado). NULL = sin logo.",
    )
    brand_logo_mime: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="Content-type del logo (image/png, image/jpeg, image/webp).",
    )
    brand_logo_updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        nullable=True,
        comment="Última actualización del logo (cache-buster del manifest).",
    )

    # -- Login con Google (política editable; el secret SIEMPRE cifrado) -----------
    google_login_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment=(
            "Botón 'Continuar con Google' en el login. Vincula cuentas por correo "
            "VERIFICADO de Google; el alta de cuentas nuevas exige además el "
            "registro público efectivo (mismo doble candado que el registro)."
        ),
    )
    google_auth_client_id: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="Client ID del OAuth de Google para el LOGIN (distinto del de respaldos).",
    )
    google_auth_client_secret_ciphertext: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Client secret del OAuth de login CIFRADO (Fernet). Nunca se proyecta a la API.",
    )

    # -- Analítica del sitio público (GA4; el ID de medición es público) ------------
    analytics_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment=(
            "Google Analytics 4 en el sitio público (storefront + login/registro). "
            "Apagado no se carga ningún script ni se envía evento alguno. El panel "
            "y el admin NUNCA se miden."
        ),
    )
    analytics_ga4_measurement_id: Mapped[Optional[str]] = mapped_column(
        String(30),
        nullable=True,
        comment=(
            "ID de medición de GA4 (G-XXXXXXXXXX). Es un identificador público por "
            "diseño de Google; aquí no se guarda ningún secreto de analítica."
        ),
    )
    analytics_require_consent: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        comment=(
            "Exigir consentimiento de cookies analíticas: hasta que el visitante "
            "acepte, no se carga el script ni se envía ningún evento."
        ),
    )
    analytics_debug_mode: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment=(
            "Enviar los eventos con debug_mode para validarlos en GA4 DebugView. "
            "Solo para pruebas; apagar en operación normal."
        ),
    )

    # -- Correo saliente (política editable; secretos SIEMPRE cifrados) -------------
    email_mode: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="environment",
        comment=(
            "Transporte de correo: environment (SMTP_* del entorno; Mailpit en dev), "
            "smtp (credenciales de esta fila) o resend (API key de esta fila)."
        ),
    )
    email_from_address: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="Remitente para los modos smtp/resend (environment usa SMTP_FROM_*).",
    )
    email_from_name: Mapped[Optional[str]] = mapped_column(
        String(120),
        nullable=True,
        comment="Nombre visible del remitente (modos smtp/resend).",
    )
    email_smtp_host: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True, comment="Servidor SMTP (modo smtp)."
    )
    email_smtp_port: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, comment="Puerto SMTP (modo smtp)."
    )
    email_smtp_username: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True, comment="Usuario SMTP (modo smtp)."
    )
    email_smtp_password_ciphertext: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Contraseña SMTP CIFRADA (Fernet). Nunca se proyecta a la API.",
    )
    email_smtp_tls: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, comment="STARTTLS (modo smtp)."
    )
    email_smtp_ssl: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, comment="SSL/TLS directo (modo smtp)."
    )
    email_resend_api_key_ciphertext: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="API key de Resend CIFRADA (Fernet). Nunca se proyecta a la API.",
    )
    email_last_test_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime,
        nullable=True,
        comment="Momento (UTC) del último correo de prueba; lo escribe la acción de test.",
    )
    email_last_test_status: Mapped[Optional[str]] = mapped_column(
        String(20),
        nullable=True,
        comment="Resultado del último test: ok o failed (estado derivado, no editable).",
    )
    email_last_test_error: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
        comment="Resumen SEGURO del fallo del último test (sin credenciales).",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, nullable=True, onupdate=func.now()
    )
    updated_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("user.id", ondelete="RESTRICT"),
        nullable=True,
        comment="Último administrador que modificó la configuración.",
    )
