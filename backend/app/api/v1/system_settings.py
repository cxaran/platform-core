"""Configuración del sistema: singleton editable + checklist de puesta en marcha.

El router valida permisos y delega; la política vive en la base de datos y cada
cambio queda en la bitácora de auditoría con SOLO los nombres de los campos
modificados (nunca valores). Permisos: ``system_settings:read`` para el estado
seguro y el checklist; ``system_settings:configure`` para editar y descartar el
checklist.
"""

import hashlib
import hmac
import secrets
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, Query, Request, Response, UploadFile, status

from backend.app.api.resource_actions import api_error, get_or_404, paginate_resource
from backend.app.auth.auth_dependencies import CurrentUser
from backend.app.core.database import SessionDep
from backend.app.core.settings import settings
from backend.app.models.system_settings import SystemSettings
from backend.app.resources.registry import SYSTEM_SETTINGS
from backend.app.schemas.pagination import OffsetPage
from backend.app.schemas.system_settings import (
    PublicAnalyticsConfig,
    SendTestEmailRequest,
    VerifyDomainRequest,
    SetupChecklistItemRead,
    SetupChecklistRead,
    SystemSettingsListItem,
    SystemSettingsRead,
    SystemSettingsUpdate,
)
from backend.app.security.groups.system_settings import SystemSettingsPermissions
from backend.app.services import system_settings_service as system
from backend.app.services.config_audit import record_config_change
from backend.app.utils.utc_now import utc_now

router = APIRouter(tags=["system-settings"])

_NOT_FOUND = "Configuración del sistema no encontrada"


def _domain_challenge_digest(nonce: str) -> str:
    """HMAC del reto de dominio, compartido por el endpoint público
    (``domain-challenge``) y el verificador (``verify-domain``): ambos lados
    del reto no pueden divergir."""
    return hmac.new(
        settings.secret_key.get_secret_value().encode("utf-8"),
        f"domain-challenge:{nonce}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _serialize_read(session: SessionDep, row: SystemSettings) -> SystemSettingsRead:
    from backend.app.services.email_service import transport_unavailable_reason

    return SystemSettingsRead(
        id=row.id,
        public_registration_enabled=row.public_registration_enabled,
        public_registration_effective=system.is_public_registration_enabled(session),
        app_base_url=row.app_base_url,
        app_base_url_verified_at=row.app_base_url_verified_at,
        institution_name=row.institution_name,
        site_description=row.site_description,
        brand_logo_configured=row.brand_logo_content is not None,
        brand_logo_updated_at=row.brand_logo_updated_at,
        login_verification_mode=row.login_verification_mode,
        google_login_enabled=row.google_login_enabled,
        google_auth_client_id=row.google_auth_client_id,
        google_auth_client_secret_configured=row.google_auth_client_secret_ciphertext is not None,
        password_reset_enabled=row.password_reset_enabled,
        login_attempts_before_lock=row.login_attempts_before_lock,
        email_token_minutes=row.email_token_minutes,
        application_timezone=row.application_timezone,
        agent_ticket_ttl_seconds=row.agent_ticket_ttl_seconds,
        agent_lease_ttl_seconds=row.agent_lease_ttl_seconds,
        login_attempts_before_lock_effective=(
            row.login_attempts_before_lock or settings.trys_before_lock
        ),
        email_token_minutes_effective=(
            row.email_token_minutes or settings.email_token_expire_minutes
        ),
        application_timezone_effective=system.application_timezone_effective(session),
        agent_ticket_ttl_seconds_effective=(
            row.agent_ticket_ttl_seconds or settings.agent_gateway_ticket_ttl_seconds
        ),
        agent_lease_ttl_seconds_effective=(
            row.agent_lease_ttl_seconds or settings.agent_gateway_lease_ttl_seconds
        ),
        audit_retention_days=row.audit_retention_days,
        notification_retention_days=row.notification_retention_days,
        email_mode=row.email_mode,
        email_from_address=row.email_from_address,
        email_from_name=row.email_from_name,
        email_smtp_host=row.email_smtp_host,
        email_smtp_port=row.email_smtp_port,
        email_smtp_username=row.email_smtp_username,
        email_smtp_tls=row.email_smtp_tls,
        email_smtp_ssl=row.email_smtp_ssl,
        email_smtp_password_configured=row.email_smtp_password_ciphertext is not None,
        email_resend_api_key_configured=row.email_resend_api_key_ciphertext is not None,
        email_last_test_at=row.email_last_test_at,
        email_last_test_status=row.email_last_test_status,
        email_last_test_error=row.email_last_test_error,
        email_transport_reason=transport_unavailable_reason(row),
        analytics_enabled=row.analytics_enabled,
        analytics_ga4_measurement_id=row.analytics_ga4_measurement_id,
        analytics_require_consent=row.analytics_require_consent,
        analytics_debug_mode=row.analytics_debug_mode,
        environment=settings.environment,
        created_at=row.created_at,
        updated_at=row.updated_at,
        updated_by=row.updated_by,
    )


@router.get("/system-settings", response_model=OffsetPage[SystemSettingsListItem])
def list_system_settings(
    session: SessionDep,
    query: Annotated[SYSTEM_SETTINGS.Query, Query()],  # pyright: ignore[reportInvalidTypeForm]
    _: SystemSettingsPermissions.READ.requiere,
) -> OffsetPage[SystemSettingsListItem]:
    # Singleton: la "lista" devuelve una sola fila (contrato de la UI declarativa).
    return paginate_resource(SYSTEM_SETTINGS, session, query)


@router.get("/system-settings/setup-checklist", response_model=SetupChecklistRead)
def get_setup_checklist(
    session: SessionDep,
    current_user: CurrentUser,
    _: SystemSettingsPermissions.READ.requiere,
) -> SetupChecklistRead:
    """Checklist de puesta en marcha DERIVADO del estado real de la configuración."""
    items, dismissed = system.build_setup_checklist(
        session, current_user_id=current_user.id
    )
    serialized = [
        SetupChecklistItemRead(key=i.key, title=i.title, status=i.status, detail=i.detail)
        for i in items
    ]
    pending = sum(1 for i in items if i.status == "pending")
    return SetupChecklistRead(
        items=serialized,
        dismissed=dismissed,
        pending_count=pending,
        environment=settings.environment,
    )


@router.post("/system-settings/setup-checklist/dismiss", status_code=status.HTTP_204_NO_CONTENT)
def dismiss_setup_checklist(
    session: SessionDep,
    _: SystemSettingsPermissions.CONFIGURE.requiere,
) -> None:
    """Descarta el banner del checklist (el checklist sigue disponible a demanda)."""
    system.dismiss_onboarding(session)
    session.commit()


@router.get("/public/site/analytics", response_model=PublicAnalyticsConfig)
def read_public_analytics(session: SessionDep, response: Response) -> PublicAnalyticsConfig:
    """Config PÚBLICA de analítica: la lee el sitio ANTES de cargar cualquier
    script. Sin auth y cacheable; apagada no filtra ni el ID de medición. El
    frontend solo carga GA4 en rutas públicas y respetando el consentimiento."""
    response.headers["Cache-Control"] = "public, max-age=60"
    row = system.get_system_settings(session)
    if not row.analytics_enabled or not row.analytics_ga4_measurement_id:
        return PublicAnalyticsConfig(enabled=False)
    return PublicAnalyticsConfig(
        enabled=True,
        measurement_id=row.analytics_ga4_measurement_id,
        require_consent=row.analytics_require_consent,
        debug_mode=row.analytics_debug_mode,
    )


@router.get("/domain-challenge/{nonce}")
def domain_challenge(nonce: str) -> dict[str, str]:
    """Reto PÚBLICO de verificación de dominio: responde un HMAC del nonce con la
    clave de la instalación. El verificador (verify-domain) llama a este endpoint A
    TRAVÉS del dominio propuesto: si la respuesta coincide, ese dominio sirve ESTA
    instalación. Sin estado, sin auth, sin efectos."""
    if not nonce or len(nonce) > 128:
        api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "invalid_nonce", "Nonce inválido.")
    return {"challenge": _domain_challenge_digest(nonce)}


@router.post("/system-settings/{item_id}/verify-domain", response_model=SystemSettingsRead)
async def verify_domain(
    item_id: UUID,
    payload: VerifyDomainRequest,
    request: Request,
    session: SessionDep,
    current_user: CurrentUser,
    _: SystemSettingsPermissions.CONFIGURE.requiere,
) -> SystemSettingsRead:
    """Verifica y guarda el dominio base de la instalación.

    Deriva el candidato del header Origin si no se envía; lo normaliza (solo
    esquema+host+puerto) y hace la prueba REAL: pedir el domain-challenge A TRAVÉS
    de ese dominio y comparar el HMAC. Si pasa, se persiste (app_base_url +
    verified_at) y habilita los redirect URIs derivados (p. ej. Google Drive)."""
    row = get_or_404(session, SystemSettings, item_id, _NOT_FOUND)
    candidate_raw = payload.base_url or request.headers.get("origin") or ""
    candidate = system.public_base_url_or_none(candidate_raw)
    if candidate is None:
        api_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "invalid_base_url",
            "El dominio debe ser un origen http(s) sin ruta ni credenciales "
            "(HTTPS obligatorio en producción).",
        )

    nonce = secrets.token_urlsafe(24)
    expected = _domain_challenge_digest(nonce)

    import httpx

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
            response = await client.get(f"{candidate}/api/v1/domain-challenge/{nonce}")
        received = response.json().get("challenge") if response.status_code == 200 else None
    except Exception:
        received = None
    if received is None or not hmac.compare_digest(received, expected):
        api_error(
            status.HTTP_409_CONFLICT,
            "domain_verification_failed",
            f"No se pudo verificar {candidate}: el dominio no respondió el reto de "
            "esta instalación (revisa DNS/proxy y que apunte a este despliegue).",
        )

    row.app_base_url = candidate
    row.app_base_url_verified_at = utc_now()
    row.updated_by = current_user.id
    session.add(row)
    record_config_change(
        session,
        actor_user_id=current_user.id,
        entity_type="system_settings",
        entity_id=row.id,
        action="domain_verified",
        changed_fields=["app_base_url", "app_base_url_verified_at"],
    )
    session.commit()
    session.refresh(row)
    return _serialize_read(session, row)


@router.post("/system-settings/{item_id}/send-test-email", response_model=SystemSettingsRead)
async def send_test_email(
    item_id: UUID,
    payload: SendTestEmailRequest,
    session: SessionDep,
    current_user: CurrentUser,
    _: SystemSettingsPermissions.CONFIGURE.requiere,
) -> SystemSettingsRead:
    """Verifica el transporte configurado enviando un correo real y PERSISTE el
    desenlace (email_last_test_*): el checklist marca el correo como verificado
    solo tras un test exitoso."""
    from backend.app.services.email_service import send_system_email
    from backend.app.services.system_settings_service import project_display_name

    row = get_or_404(session, SystemSettings, item_id, _NOT_FOUND)
    recipient = payload.recipient or current_user.email
    display_name = project_display_name(session)
    outcome = await send_system_email(
        session,
        subject=f"{display_name}: correo de prueba",
        email_to=recipient,
        message=(
            f"Este es un correo de PRUEBA de {display_name} para verificar "
            f"el transporte configurado (modo: {row.email_mode}). Si lo recibiste, "
            "el correo saliente funciona."
        ),
    )
    row.email_last_test_at = utc_now()
    row.email_last_test_status = "ok" if outcome.sent else "failed"
    row.email_last_test_error = None if outcome.sent else (
        f"{outcome.error_code}: {outcome.error_summary}"[:255]
    )
    session.add(row)
    record_config_change(
        session,
        actor_user_id=current_user.id,
        entity_type="system_settings",
        entity_id=row.id,
        action="email_test_sent",
        changed_fields=["email_last_test_status"],
    )
    session.commit()
    session.refresh(row)
    return _serialize_read(session, row)


@router.get("/system-settings/{item_id}", response_model=SystemSettingsRead)
def get_system_settings_detail(
    item_id: UUID,
    session: SessionDep,
    _: SystemSettingsPermissions.READ.requiere,
) -> SystemSettingsRead:
    row = get_or_404(session, SystemSettings, item_id, _NOT_FOUND)
    return _serialize_read(session, row)


@router.patch("/system-settings/{item_id}", response_model=SystemSettingsRead)
def update_system_settings(
    item_id: UUID,
    payload: SystemSettingsUpdate,
    session: SessionDep,
    current_user: CurrentUser,
    _: SystemSettingsPermissions.CONFIGURE.requiere,
) -> SystemSettingsRead:
    row = get_or_404(session, SystemSettings, item_id, _NOT_FOUND)
    data = payload.model_dump(exclude_unset=True)
    changed_field_names = list(data.keys())
    if not data:
        return _serialize_read(session, row)

    # Activar la verificación de login exige un transporte de correo UTILIZABLE:
    # sin correo no llegan los códigos y los usuarios sin cobertura administrativa
    # quedarían fuera (los administradores completos están exentos por diseño).
    if data.get("login_verification_mode") in ("code", "link"):
        from backend.app.services.email_service import transport_unavailable_reason

        reason = transport_unavailable_reason(row)
        if reason is not None:
            api_error(
                status.HTTP_409_CONFLICT,
                "login_verification_requires_email",
                f"Configura el correo saliente antes de activar la verificación: {reason}",
            )

    # Activar el login con Google exige credenciales COMPLETAS (client ID en la
    # fila o en este mismo PATCH, y secret ya guardado o entrante): un switch sin
    # credenciales sería un botón muerto en el login.
    if data.get("google_login_enabled") is True:
        has_client_id = bool(data.get("google_auth_client_id") or row.google_auth_client_id)
        has_secret = bool(
            data.get("google_auth_client_secret")
            or row.google_auth_client_secret_ciphertext
        )
        if not has_client_id or not has_secret:
            api_error(
                status.HTTP_409_CONFLICT,
                "google_login_requires_credentials",
                "Configura el client ID y el client secret de Google antes de "
                "habilitar el inicio de sesión con Google.",
            )

    # Activar la analítica exige un ID de medición (en la fila o en este mismo
    # PATCH): un switch sin ID sería medición muerta que aparenta funcionar.
    if data.get("analytics_enabled") is True:
        has_measurement_id = bool(
            data.get("analytics_ga4_measurement_id") or row.analytics_ga4_measurement_id
        )
        if not has_measurement_id:
            api_error(
                status.HTTP_409_CONFLICT,
                "analytics_requires_measurement_id",
                "Configura el ID de medición de GA4 (G-XXXXXXXXXX) antes de "
                "habilitar la analítica del sitio.",
            )

    # Secretos WRITE-ONLY: valor -> cifrar y reemplazar; null -> borrar; omitido ->
    # conservar. Nunca pasan por setattr (no existen como columnas en claro).
    from backend.app.services.secret_cipher import SecretCipherError, encrypt_secret

    secret_targets = {
        "email_smtp_password": "email_smtp_password_ciphertext",
        "email_resend_api_key": "email_resend_api_key_ciphertext",
        "google_auth_client_secret": "google_auth_client_secret_ciphertext",
    }
    try:
        for field, column in secret_targets.items():
            if field in data:
                value = data.pop(field)
                setattr(row, column, encrypt_secret(value) if value else None)
    except SecretCipherError as error:
        api_error(status.HTTP_409_CONFLICT, error.code, error.summary)

    for field, value in data.items():
        setattr(row, field, value)
    row.updated_by = current_user.id
    row.updated_at = utc_now()
    session.add(row)
    record_config_change(
        session,
        actor_user_id=current_user.id,
        entity_type="system_settings",
        entity_id=row.id,
        action="system_settings_updated",
        changed_fields=changed_field_names,
    )
    session.commit()
    session.refresh(row)
    # La zona horaria cambia la semántica de los filtros de calendario: se invalida el
    # caché del proceso para que aplique de inmediato (otros workers la recogen por TTL).
    if "application_timezone" in changed_field_names:
        system.invalidate_application_timezone_cache()
    return _serialize_read(session, row)


# --- Logo de la instalación (marca de la PWA) ---------------------------------------

# Tope del archivo del logo. Suficiente para cualquier logo raster razonable;
# protege la fila singleton (el binario viaja en cada lectura administrativa).
_LOGO_MAX_BYTES = 2 * 1024 * 1024
# Formatos raster ADMITIDOS (Pillow los identifica del CONTENIDO; el mime que se
# guarda deriva del formato real, nunca del header del cliente). SVG queda
# bloqueado por diseño: jamás se sirve markup como imagen de marca.
_LOGO_MIME_BY_FORMAT = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}


@router.put("/system-settings/{item_id}/logo", response_model=SystemSettingsRead)
async def upload_brand_logo(
    item_id: UUID,
    session: SessionDep,
    current_user: CurrentUser,
    _: SystemSettingsPermissions.CONFIGURE.requiere,
    file: UploadFile = File(...),
) -> SystemSettingsRead:
    """Sube (o reemplaza) el logo de la instalación para el manifest de la PWA.

    El contenido se VERIFICA con Pillow antes de guardar: solo PNG/JPEG/WEBP
    reales. La auditoría registra el cambio sin el binario.
    """
    import io

    from PIL import Image, UnidentifiedImageError

    row = get_or_404(session, SystemSettings, item_id, _NOT_FOUND)
    content = await file.read()
    if not content:
        api_error(status.HTTP_422_UNPROCESSABLE_ENTITY, "logo_vacio", "El archivo está vacío.")
    if len(content) > _LOGO_MAX_BYTES:
        api_error(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "logo_demasiado_grande",
            "El logo no puede superar los 2 MB.",
        )
    try:
        with Image.open(io.BytesIO(content)) as image:
            detected = (image.format or "").upper()
    except (UnidentifiedImageError, OSError, ValueError):
        detected = ""
    mime = _LOGO_MIME_BY_FORMAT.get(detected)
    if mime is None:
        api_error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "logo_formato_invalido",
            "El logo debe ser una imagen PNG, JPEG o WEBP (SVG no se admite).",
        )

    row.brand_logo_content = content
    row.brand_logo_mime = mime
    row.brand_logo_updated_at = utc_now()
    row.updated_by = current_user.id
    row.updated_at = utc_now()
    session.add(row)
    record_config_change(
        session,
        actor_user_id=current_user.id,
        entity_type="system_settings",
        entity_id=row.id,
        action="system_settings_updated",
        changed_fields=["brand_logo"],
    )
    session.commit()
    session.refresh(row)
    return _serialize_read(session, row)


@router.delete("/system-settings/{item_id}/logo", response_model=SystemSettingsRead)
def delete_brand_logo(
    item_id: UUID,
    session: SessionDep,
    current_user: CurrentUser,
    _: SystemSettingsPermissions.CONFIGURE.requiere,
) -> SystemSettingsRead:
    """Quita el logo: el manifest vuelve a los íconos placeholder."""
    row = get_or_404(session, SystemSettings, item_id, _NOT_FOUND)
    row.brand_logo_content = None
    row.brand_logo_mime = None
    row.brand_logo_updated_at = None
    row.updated_by = current_user.id
    row.updated_at = utc_now()
    session.add(row)
    record_config_change(
        session,
        actor_user_id=current_user.id,
        entity_type="system_settings",
        entity_id=row.id,
        action="system_settings_updated",
        changed_fields=["brand_logo"],
    )
    session.commit()
    session.refresh(row)
    return _serialize_read(session, row)
