"""Puente INTERNO server-to-server de arriendo de credencial de proveedor de IA.

ATENCIÓN: endpoint INTERNO, no para el navegador. Devuelve el secreto DESCIFRADO
(API key) de vida corta para que el Agent Gateway lo use durante un turn. Se autentica
con un secreto compartido server-to-server (header ``X-Internal-Auth``), NO con cookie
de usuario. En despliegue debe quedar detrás de red interna (no expuesto públicamente).
El secreto descifrado y el secreto interno NUNCA se loguean.
"""

import uuid
from datetime import timedelta

from fastapi import APIRouter, Header, Request, status
from sqlmodel import select

import secrets as secrets_lib

from backend.app.agent.crypto import decrypt_secret
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

    # v1: solo credenciales API key. OAuth queda reservado para una rebanada posterior.
    if credential.credential_type != AiCredentialType.API_KEY:
        api_error(
            status.HTTP_501_NOT_IMPLEMENTED,
            "credential_type_unsupported",
            "El arriendo de credenciales OAuth aún no está implementado.",
        )

    from backend.app.services.system_settings_service import agent_lease_ttl_effective

    lease_id = uuid.uuid4()
    expires_at = utc_now() + timedelta(seconds=agent_lease_ttl_effective(session))
    secret = decrypt_secret(credential.secret_encrypted)

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
        account_id=None,
    )
