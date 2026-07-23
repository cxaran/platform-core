"""Puente INTERNO server-to-server de arriendo de credencial de proveedor de IA.

ATENCIÓN: endpoint INTERNO, no para el navegador. Devuelve el secreto DESCIFRADO
(API key) de vida corta para que el Agent Gateway lo use durante un turn. Se autentica
con un secreto compartido server-to-server (header ``X-Internal-Auth``), NO con cookie
de usuario. En despliegue debe quedar detrás de red interna (no expuesto públicamente).
El secreto descifrado y el secreto interno NUNCA se loguean.
"""

import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Header, Request, status
from sqlmodel import select

import secrets as secrets_lib

from backend.app.agent.oauth import (
    OAuthError,
    decode_oauth_profile,
    encode_oauth_profile,
    ensure_fresh_access_token,
    profile_expires_at,
)
from backend.app.services.secret_cipher import decrypt_secret
from backend.app.api.resource_actions import api_error
from backend.app.core.database import SessionDep
from backend.app.core.settings import settings
from backend.app.models.ai_provider_credential import AiProviderCredential
from backend.app.models.audit_event import AuditEvent
from backend.app.models.enums import AiCredentialType
from backend.app.schemas.agent import CredentialLeaseRequest, CredentialLeaseResponse
from backend.app.security.rate_limit import limit_internal_lease
from backend.app.utils.utc_now import utc_now

router = APIRouter(prefix="/internal/agent", tags=["internal"])


@router.post("/credential-lease", response_model=CredentialLeaseResponse)
def lease_credential(
    payload: CredentialLeaseRequest,
    request: Request,
    session: SessionDep,
    x_internal_auth: str | None = Header(default=None, alias="X-Internal-Auth"),
) -> CredentialLeaseResponse:
    # Secreto compartido server-to-server (X-Internal-Auth), comparado en tiempo constante.
    expected = settings.agent_gateway_internal_secret
    if expected is None or not expected.get_secret_value().strip():
        api_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "internal_auth_not_configured",
            "El puente interno no está configurado.",
        )
    if not x_internal_auth or not secrets_lib.compare_digest(
        x_internal_auth, expected.get_secret_value()
    ):
        api_error(
            status.HTTP_401_UNAUTHORIZED,
            "invalid_internal_auth",
            "Credencial interna inválida.",
        )
    limit_internal_lease(request)

    query = select(AiProviderCredential).where(
        AiProviderCredential.user_id == payload.user_id,
        AiProviderCredential.provider == payload.provider,
        AiProviderCredential.is_active.is_(True),
        AiProviderCredential.deleted_at.is_(None),
    )
    # Si el gateway especifica el tipo, se arrienda EXACTAMENTE esa credencial.
    if payload.credential_type is not None:
        query = query.where(
            AiProviderCredential.credential_type == payload.credential_type
        )
    credential = session.exec(query).first()
    if credential is None:
        api_error(
            status.HTTP_404_NOT_FOUND,
            "credential_not_found",
            "No hay credencial activa para ese usuario y proveedor.",
        )

    from backend.app.services.system_settings_service import agent_lease_ttl_effective

    lease_id = uuid.uuid4()
    ttl_expires_at = utc_now() + timedelta(seconds=agent_lease_ttl_effective(session))
    account_id: str | None = None

    if credential.credential_type == AiCredentialType.OAUTH:
        # Credencial OAuth (ChatGPT Plus/Codex): el "secreto" arrendado es el ACCESS
        # token vigente; se refresca si venció o está por vencer y se reguarda cifrado.
        try:
            profile = decode_oauth_profile(credential.secret_encrypted)
            fresh_profile, refreshed = ensure_fresh_access_token(profile)
        except OAuthError as exc:
            api_error(status.HTTP_502_BAD_GATEWAY, exc.code, exc.message)
        if refreshed:
            credential.secret_encrypted = encode_oauth_profile(fresh_profile)
            credential.updated_at = utc_now()
        access = fresh_profile.get("access")
        if not isinstance(access, str) or not access:
            api_error(
                status.HTTP_502_BAD_GATEWAY,
                "oauth_no_access_token",
                "La conexión OAuth no tiene un access token disponible.",
            )
        secret = access
        # La cuenta ChatGPT (no secreta) viaja al Gateway para el header chatgpt-account-id.
        profile_account = fresh_profile.get("account_id")
        account_id = profile_account if isinstance(profile_account, str) else None
        # El arriendo no debe sobrevivir al access token: se toma el menor vencimiento.
        token_expires_at = profile_expires_at(fresh_profile)
        expires_at = (
            min(ttl_expires_at, token_expires_at)
            if isinstance(token_expires_at, datetime)
            else ttl_expires_at
        )
    else:
        secret = decrypt_secret(credential.secret_encrypted)
        if secret is None:
            api_error(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "credential_undecryptable",
                "La credencial guardada no puede descifrarse con las claves configuradas.",
            )
        expires_at = ttl_expires_at

    # Auditoría del arriendo: registra el evento SIN el secreto.
    session.add(
        AuditEvent(
            entity_type="ai_provider_credentials",
            entity_id=credential.id,
            action="ai_credential_leased",
            actor_user_id=credential.user_id,
            changed_fields={"lease_id": str(lease_id), "provider": credential.provider.value},
        )
    )
    session.commit()

    return CredentialLeaseResponse(
        lease_id=lease_id,
        secret=secret,
        expires_at=expires_at,
        default_model=credential.default_model,
        account_id=account_id,
    )
