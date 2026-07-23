"""Flujo OAuth ChatGPT Plus/Codex del usuario autenticado (owner-only).

Conecta la cuenta del usuario por OAuth browser-callback PKCE (NO device-code) y
guarda el perfil OAuth {access, refresh, expires, account_id} CIFRADO como una
credencial ``provider=openai`` / ``credential_type=oauth``. El perfil nunca se
devuelve en claro y los tokens nunca se loguean. El arriendo interno entrega el
access token vigente a partir de este perfil (proveedor ``openai_codex``).
"""

import uuid

from fastapi import APIRouter, status
from sqlmodel import select

from backend.app.agent.oauth import (
    OAuthError,
    build_authorize_url,
    code_challenge_s256,
    decode_oauth_profile,
    encode_oauth_profile,
    exchange_code,
    generate_code_verifier,
    generate_state,
    pkce_store,
    profile_expires_at,
)
from backend.app.api.resource_actions import (
    api_error,
    commit_or_conflict,
    soft_delete_entity,
)
from backend.app.auth.auth_dependencies import CurrentUser
from backend.app.core.database import SessionDep
from backend.app.core.settings import settings
from backend.app.models.ai_provider_credential import AiProviderCredential
from backend.app.models.audit_event import AuditEvent
from backend.app.models.enums import AiCredentialType, AiProvider
from backend.app.schemas.agent import (
    OAuthCompleteRequest,
    OAuthStartResponse,
    OAuthStatusResponse,
)
from backend.app.schemas.auth import MessageResponse

router = APIRouter(prefix="/users/me/ai-providers/oauth/openai", tags=["ai-providers"])

OAUTH_LABEL = "ChatGPT (OAuth)"
# Página del frontend que completa el flujo (recibe code+state del proveedor).
OAUTH_CALLBACK_PATH = "/account/oauth/callback"


def _resolve_redirect_uri(session: SessionDep) -> str | None:
    """Redirect URI del flujo: el del entorno o, sin definir, derivado de la URL
    declarada de la instalación (``app_base_url`` + página de callback)."""
    if settings.openai_oauth_redirect_uri:
        return settings.openai_oauth_redirect_uri
    from backend.app.services.system_settings_service import installation_base_url

    base = installation_base_url(session)
    return f"{base}{OAUTH_CALLBACK_PATH}" if base else None


def _require_oauth_configured(session: SessionDep) -> tuple[str, str]:
    """Devuelve (client_id, redirect_uri) o 503 si el flujo no está configurado."""
    client_id = settings.openai_oauth_client_id
    redirect_uri = _resolve_redirect_uri(session)
    if not client_id or not redirect_uri:
        api_error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "oauth_not_configured",
            "El flujo OAuth de OpenAI no está configurado (client_id y una URL "
            "de instalación declarada o OPENAI_OAUTH_REDIRECT_URI).",
        )
    return client_id, redirect_uri


def _get_oauth_credential(
    session: SessionDep,
    user_id: uuid.UUID,
) -> AiProviderCredential | None:
    """Credencial OAuth vigente (no eliminada) del usuario para OpenAI, o ``None``."""
    return session.exec(
        select(AiProviderCredential).where(
            AiProviderCredential.user_id == user_id,
            AiProviderCredential.provider == AiProvider.OPENAI,
            AiProviderCredential.credential_type == AiCredentialType.OAUTH,
            AiProviderCredential.deleted_at.is_(None),
        )
    ).first()


@router.post("/start", response_model=OAuthStartResponse)
def start_oauth(
    session: SessionDep,
    current_user: CurrentUser,
) -> OAuthStartResponse:
    client_id, redirect_uri = _require_oauth_configured(session)

    code_verifier = generate_code_verifier()
    state = generate_state()
    pkce_store.put(str(current_user.id), state, code_verifier)

    authorize_url = build_authorize_url(
        authorize_url=settings.openai_oauth_authorize_url,
        client_id=client_id,
        redirect_uri=redirect_uri,
        code_challenge=code_challenge_s256(code_verifier),
        state=state,
        scope=settings.openai_oauth_scope,
    )
    return OAuthStartResponse(authorize_url=authorize_url, state=state)


@router.post("/complete", response_model=OAuthStatusResponse)
def complete_oauth(
    payload: OAuthCompleteRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> OAuthStatusResponse:
    _, redirect_uri = _require_oauth_configured(session)

    code_verifier = pkce_store.take(str(current_user.id), payload.state)
    if code_verifier is None:
        api_error(
            status.HTTP_400_BAD_REQUEST,
            "invalid_oauth_state",
            "Estado OAuth inválido o expirado; reinicia la conexión.",
        )

    try:
        profile = exchange_code(
            code=payload.code, code_verifier=code_verifier, redirect_uri=redirect_uri
        )
        secret_encrypted = encode_oauth_profile(profile)
    except OAuthError as exc:
        api_error(status.HTTP_502_BAD_GATEWAY, exc.code, exc.message)

    credential = _get_oauth_credential(session, current_user.id)
    if credential is None:
        credential = AiProviderCredential(
            user_id=current_user.id,
            provider=AiProvider.OPENAI,
            credential_type=AiCredentialType.OAUTH,
            label=OAUTH_LABEL,
            secret_encrypted=secret_encrypted,
            is_active=True,
            created_by=current_user.id,
        )
        session.add(credential)
        action = "ai_oauth_connected"
    else:
        credential.secret_encrypted = secret_encrypted
        credential.is_active = True
        credential.updated_by = current_user.id
        action = "ai_oauth_reconnected"

    session.flush()
    # Auditoría SIN tokens: solo el id de cuenta (no es secreto) y el provider.
    account_id = profile.get("account_id")
    session.add(
        AuditEvent(
            entity_type="ai_provider_credentials",
            entity_id=credential.id,
            action=action,
            actor_user_id=current_user.id,
            changed_fields={
                "provider": AiProvider.OPENAI.value,
                "account_id": account_id if isinstance(account_id, str) else None,
            },
        )
    )
    commit_or_conflict(session, "No se pudo guardar la conexión OAuth")

    return OAuthStatusResponse(
        connected=True,
        account_id=account_id if isinstance(account_id, str) else None,
        expires_at=profile_expires_at(profile),
    )


@router.get("/status", response_model=OAuthStatusResponse)
def oauth_status(
    session: SessionDep,
    current_user: CurrentUser,
) -> OAuthStatusResponse:
    credential = _get_oauth_credential(session, current_user.id)
    if credential is None:
        return OAuthStatusResponse(connected=False)

    # No se expone el perfil para el status; se reporta conexión y, si se puede
    # leer sin exponer tokens, la cuenta y el vencimiento.
    try:
        profile = decode_oauth_profile(credential.secret_encrypted)
    except OAuthError:
        return OAuthStatusResponse(connected=True)

    account_id = profile.get("account_id")
    return OAuthStatusResponse(
        connected=True,
        account_id=account_id if isinstance(account_id, str) else None,
        expires_at=profile_expires_at(profile),
    )


@router.delete("", response_model=MessageResponse)
def disconnect_oauth(
    session: SessionDep,
    current_user: CurrentUser,
) -> MessageResponse:
    credential = _get_oauth_credential(session, current_user.id)
    if credential is None:
        api_error(
            status.HTTP_404_NOT_FOUND,
            "resource_not_found",
            "No hay una conexión OAuth activa para desconectar.",
        )
    soft_delete_entity(
        session,
        credential,
        actor_id=current_user.id,
        already_deleted_message="La conexión OAuth ya estaba desconectada",
    )
    return MessageResponse(message="Conexión OAuth desconectada correctamente")
