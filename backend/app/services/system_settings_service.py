"""Servicio del singleton de configuración del sistema.

La política vive en la base de datos (fuente de verdad, editable y auditada); las
variables de entorno conservan sólo los GATES de despliegue que la UI no puede
saltar (``registration_allowed_effective``). El checklist de puesta en marcha es
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
    """Política EFECTIVA de registro público: gate de despliegue AND política
    persistida. Producción con el gate cerrado nunca abre registro, diga lo que
    diga la base de datos."""
    if not settings.registration_allowed_effective:
        return False
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

    items.append(
        ChecklistItem(
            key="domain",
            title="Dominio de la instalación",
            status="complete" if system.app_base_url_verified_at else "pending",
            detail=(
                system.app_base_url or "Confirma el dominio para calcular las URLs de OAuth."
            ),
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
) -> None:
    """Aplica al singleton las decisiones tomadas en el asistente de bootstrap."""
    row = get_system_settings(session, for_update=True)
    row.public_registration_enabled = public_registration_enabled
    row.password_reset_enabled = password_reset_enabled
    if institution_name:
        row.institution_name = institution_name.strip()
    session.add(row)
