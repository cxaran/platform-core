"""Servicio del singleton de configuración del sistema.

La política vive en la base de datos (fuente de verdad, editable y auditada); las
variables de entorno conservan sólo defaults de despliegue (duración de sesiones,
transporte de correo del entorno). El checklist de puesta en marcha es
DERIVADO del estado real — nunca persiste progreso propio, así no puede
desincronizarse de la configuración.
"""

import uuid
from dataclasses import dataclass
from typing import Literal, Optional

from sqlmodel import Session, select

from backend.app.core.settings import settings
from backend.app.models.setup import PlatformSetup
from backend.app.models.system_settings import SystemSettings


def get_system_settings(session: Session, *, for_update: bool = False) -> SystemSettings:
    """Fila singleton (la migración la siembra; si falta, se crea con defaults)."""
    statement = select(SystemSettings)
    if for_update:
        statement = statement.with_for_update()
    row = session.exec(statement).first()
    if row is None:
        row = SystemSettings()
        session.add(row)
        session.flush()
    return row


def is_public_registration_enabled(session: Session) -> bool:
    """Política de registro público: manda únicamente lo persistido en
    ``system_settings`` (editable y auditado desde la UI)."""
    return get_system_settings(session).public_registration_enabled


def login_verification_mode(session: Session) -> str:
    """Modo del segundo paso de login por correo: disabled | code | link."""
    return get_system_settings(session).login_verification_mode


def is_password_reset_enabled(session: Session) -> bool:
    """Política de recuperación de contraseña (sólo DB; sin candado de despliegue:
    es de bajo riesgo — actúa sobre cuentas existentes vía su correo)."""
    return get_system_settings(session).password_reset_enabled


ChecklistStatus = Literal["complete", "pending", "not_applicable"]


@dataclass(frozen=True)
class ChecklistItem:
    """Ítem del checklist de puesta en marcha (estado DERIVADO)."""

    key: str
    title: str
    status: ChecklistStatus
    detail: str


def build_setup_checklist(
    session: Session, *, current_user_id: Optional[uuid.UUID] = None
) -> tuple[list[ChecklistItem], bool]:
    """(ítems, dismissed). Cada estado se deriva de la configuración real."""
    system = get_system_settings(session)

    items: list[ChecklistItem] = []

    items.append(
        ChecklistItem(
            key="institution",
            title="Datos de la institución",
            status="complete" if system.institution_name else "pending",
            detail=(
                system.institution_name
                if system.institution_name
                else "Configura el nombre de la institución para membretes y documentos."
            ),
        )
    )

    items.append(
        ChecklistItem(
            key="registration",
            title="Registro público",
            status="complete",  # siempre es una decisión tomada (default: cerrado)
            detail=(
                "Habilitado"
                if is_public_registration_enabled(session)
                else "Deshabilitado (los administradores crean las cuentas)."
            ),
        )
    )

    if system.app_base_url_verified_at:
        domain_detail = f"{system.app_base_url} (verificado)."
    elif system.app_base_url:
        domain_detail = (
            f"{system.app_base_url} declarado; verifícalo (reto de dominio) para "
            "habilitar los respaldos a Google Drive."
        )
    else:
        domain_detail = (
            "Declara y verifica el dominio: es la base de los enlaces de correo y "
            "del OAuth (login con Google, Drive)."
        )
    items.append(
        ChecklistItem(
            key="domain",
            title="Dominio de la instalación",
            status="complete" if system.app_base_url_verified_at else "pending",
            detail=domain_detail,
        )
    )

    # Correo: deriva del transporte REAL configurado (misma regla que el envío).
    from backend.app.services.email_service import transport_unavailable_reason

    email_reason = transport_unavailable_reason(system)
    if email_reason is not None:
        email_status: ChecklistStatus = "pending"
        email_detail = email_reason
    elif system.email_mode == "environment" and settings.environment == "local":
        email_status = "complete"
        email_detail = "Mailpit automático (entorno de desarrollo)."
    elif system.email_last_test_status == "ok":
        email_status = "complete"
        email_detail = f"Transporte {system.email_mode} verificado con correo de prueba."
    else:
        email_status = "pending"
        email_detail = (
            "Envía un correo de prueba para verificar el transporte "
            f"({system.email_mode})."
        )
    items.append(
        ChecklistItem(
            key="email",
            title="Correo saliente",
            status=email_status,
            detail=email_detail,
        )
    )

    from backend.app.models.backup import BackupSettings

    backup = session.exec(select(BackupSettings)).first()
    backups_ready = backup is not None and backup.enabled
    items.append(
        ChecklistItem(
            key="backups",
            title="Respaldos a Google Drive",
            status="complete" if backups_ready else "pending",
            detail=(
                "Respaldo diario habilitado."
                if backups_ready
                else "Conecta Google Drive y habilita el respaldo diario."
            ),
        )
    )

    verification = system.login_verification_mode
    items.append(
        ChecklistItem(
            key="login_verification",
            title="Verificación de inicio de sesión",
            status="complete",  # siempre es una decisión tomada (default: deshabilitada)
            detail=(
                {"code": "Código por correo en cada inicio de sesión.",
                 "link": "Enlace por correo en cada inicio de sesión."}.get(
                    verification,
                    "Deshabilitada (sólo contraseña). Los administradores con "
                    "cobertura completa quedan exentos siempre.",
                )
            ),
        )
    )

    items.append(
        ChecklistItem(
            key="google_login",
            title="Inicio de sesión con Google",
            status="complete",  # decisión tomada (default: deshabilitado)
            detail=(
                "Habilitado."
                if system.google_login_enabled
                else "Deshabilitado (los usuarios entran con contraseña)."
            ),
        )
    )

    items.append(
        ChecklistItem(
            key="analytics",
            title="Analítica del sitio (GA4)",
            status="complete",  # decisión tomada (default: apagada; es opcional)
            detail=(
                f"Habilitada ({system.analytics_ga4_measurement_id})."
                if system.analytics_enabled
                else "Deshabilitada (opcional: se configura aquí con el ID de medición de GA4)."
            ),
        )
    )

    setup = session.get(PlatformSetup, 1)
    dismissed = setup is not None and setup.onboarding_dismissed_at is not None
    return items, dismissed


def dismiss_onboarding(session: Session) -> None:
    """Marca el checklist como descartado (no vuelve a mostrarse como banner)."""
    from backend.app.utils.utc_now import utc_now

    setup = session.get(PlatformSetup, 1)
    if setup is not None and setup.onboarding_dismissed_at is None:
        setup.onboarding_dismissed_at = utc_now()
        session.add(setup)


def apply_bootstrap_choices(
    session: Session,
    *,
    public_registration_enabled: bool,
    institution_name: Optional[str],
    password_reset_enabled: bool = True,
    app_base_url: Optional[str] = None,
) -> None:
    """Aplica al singleton las decisiones tomadas en el asistente de bootstrap."""
    row = get_system_settings(session, for_update=True)
    row.public_registration_enabled = public_registration_enabled
    row.password_reset_enabled = password_reset_enabled
    if institution_name:
        row.institution_name = institution_name.strip()
    if app_base_url:
        # Dominio declarado por el operador en el asistente (confianza del token de
        # setup). Se persiste SIN verified_at: el reto HMAC (verify-domain) sigue
        # siendo la verificación real que pide el checklist y habilita los redirect
        # URIs derivados.
        normalized = public_base_url_or_none(app_base_url)
        if normalized is not None:
            row.app_base_url = normalized
    session.add(row)


def public_base_url_or_none(raw: str) -> Optional[str]:
    """Normaliza el dominio público de la instalación o devuelve ``None``.

    Única puerta de escritura de ``app_base_url`` (bootstrap y verify-domain):
    valida el formato (origen http(s) sin ruta/credenciales) y, en producción,
    exige HTTPS — un dominio http produciría enlaces y redirects inseguros.
    """
    from backend.app.utils.base_url import normalize_base_url

    normalized = normalize_base_url(raw)
    if normalized is None:
        return None
    if settings.environment == "production" and not normalized.startswith("https://"):
        return None
    return normalized


def installation_base_url(session: Session) -> Optional[str]:
    """URL pública de la instalación para construir enlaces absolutos (correos).

    Es el dominio declarado por el administrador en el bootstrap o en
    Configuración (``app_base_url``). ``None`` mientras no exista: el correo
    degrada a token en texto (sin enlace).
    """
    row = get_system_settings(session)
    if row.app_base_url:
        return row.app_base_url.rstrip("/")
    return None


def verified_installation_base_url(session: Session) -> Optional[str]:
    """URL pública SOLO si el dominio pasó el reto HMAC (``verify-domain``).

    Es la base que exigen los redirect URIs de OAuth (login con Google, Drive):
    posesión probada del dominio, no solo intención declarada. ``None`` si no
    hay dominio verificado.
    """
    row = get_system_settings(session)
    if row.app_base_url and row.app_base_url_verified_at:
        return row.app_base_url.rstrip("/")
    return None


def trys_before_lock_effective(session: Session) -> int:
    """Intentos fallidos antes de bloquear: política en BD o default del despliegue."""
    return (
        get_system_settings(session).login_attempts_before_lock
        or settings.trys_before_lock
    )


def email_token_minutes_effective(session: Session) -> int:
    """Vigencia (minutos) de tokens por correo: política en BD o default del despliegue."""
    return (
        get_system_settings(session).email_token_minutes
        or settings.email_token_expire_minutes
    )


def agent_ticket_ttl_effective(session: Session) -> int:
    """TTL (segundos) del ticket del Agent Gateway: BD o default del despliegue."""
    return (
        get_system_settings(session).agent_ticket_ttl_seconds
        or settings.agent_gateway_ticket_ttl_seconds
    )


def agent_lease_ttl_effective(session: Session) -> int:
    """TTL (segundos) del arriendo de credencial de IA: BD o default del despliegue."""
    return (
        get_system_settings(session).agent_lease_ttl_seconds
        or settings.agent_gateway_lease_ttl_seconds
    )


def project_display_name(session: Session) -> str:
    """Nombre visible de la instalación para correos y textos generados.

    Consolidación: el nombre EDITABLE es ``institution_name`` (ya existente); el
    ``project_name`` del entorno queda como default de despliegue/marca base.
    """
    row = get_system_settings(session)
    name = (row.institution_name or "").strip()
    return name or settings.project_name


def application_timezone_effective(session: Session) -> str:
    """Zona horaria IANA de la instalación: política en BD o default del despliegue.

    Defensa: si lo guardado no es una zona válida (no debería: el schema de update
    la valida), se cae al default del despliegue en lugar de romper los filtros.
    """
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    stored = (get_system_settings(session).application_timezone or "").strip()
    if stored:
        try:
            ZoneInfo(stored)
            return stored
        except (ZoneInfoNotFoundError, ValueError):
            pass
    return settings.application_timezone


# --- Caché de proceso de la zona horaria (para el resolver del motor de query) -----
#
# El compilador de queries aplica los filtros de calendario en cada request pero no
# recibe una Session del dominio; consultar la fila singleton en cada filtro sería un
# costo por request. Este caché corto (TTL) amortiza la lectura: el cambio del
# administrador aplica en segundos en todos los workers, sin reiniciar.

_TZ_CACHE_TTL_SECONDS = 30.0
_tz_cache: tuple[float, str] | None = None


def invalidate_application_timezone_cache() -> None:
    """Invalida el caché del proceso actual (el resto lo recoge por TTL)."""
    global _tz_cache
    _tz_cache = None


def cached_application_timezone() -> str:
    """Zona horaria efectiva con caché corto y sesión propia (uso: motor de query).

    Nunca lanza: ante cualquier fallo (BD caída, arranque temprano) devuelve el
    default del despliegue, que es el mismo comportamiento previo a esta política.
    """
    import time

    global _tz_cache
    now = time.monotonic()
    if _tz_cache is not None and (now - _tz_cache[0]) < _TZ_CACHE_TTL_SECONDS:
        return _tz_cache[1]
    try:
        from backend.app.core.database import engine

        with Session(engine) as own_session:
            value = application_timezone_effective(own_session)
    except Exception:
        value = settings.application_timezone
    _tz_cache = (now, value)
    return value
