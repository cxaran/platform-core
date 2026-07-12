import uuid
from datetime import datetime
from typing import Optional

from backend.app.models.enums import AiCredentialType, AiProvider
from backend.app.schemas.base import ApiSchema, ApiWriteSchema


class ConnectionTicketRead(ApiSchema):
    """Ticket de conexión al Agent Gateway emitido a un usuario con sesión válida.

    ``ticket`` es un JWT HS256 corto y firmado; ``expires_at`` es su vencimiento
    (UTC). No incluye datos del negocio, permisos ni secretos.
    """

    ticket: str
    expires_at: datetime


class CredentialLeaseRequest(ApiWriteSchema):
    """Solicitud server-to-server de arriendo de credencial (endpoint interno)."""

    user_id: uuid.UUID
    provider: AiProvider
    # Desambigua cuando el usuario tiene más de una credencial para el mismo provider.
    # None = cualquiera activa (compat).
    credential_type: Optional[AiCredentialType] = None


class CredentialLeaseResponse(ApiSchema):
    """Arriendo de credencial: el ``secret`` es la API key DESCIFRADA, de vida corta.

    Solo lo consume el Agent Gateway por el puente interno; nunca el navegador. El
    secreto nunca se loguea.
    """

    lease_id: uuid.UUID
    secret: str
    expires_at: datetime
    default_model: Optional[str] = None
    # Reservado para credenciales OAuth (header chatgpt-account-id). None para API keys.
    account_id: Optional[str] = None
