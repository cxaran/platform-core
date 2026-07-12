import uuid
from datetime import datetime
from typing import Optional

from pydantic import Field

from backend.app.models.enums import AiCredentialType, AiProvider
from backend.app.schemas.base import ApiPatchSchema, ApiReadSchema, ApiWriteSchema


class AiProviderCredentialCreate(ApiWriteSchema):
    """Alta de una credencial de proveedor de IA del usuario autenticado.

    ``secret`` es el secreto EN CLARO (entrada): se cifra antes de guardar y nunca
    se devuelve. La auditoría y el soft-delete los gobierna el servidor.
    """

    provider: AiProvider = Field(title="Proveedor")
    label: str = Field(min_length=1, max_length=120, title="Etiqueta")
    secret: str = Field(min_length=1, title="Secreto", description="Secreto del proveedor (solo entrada).")
    default_model: Optional[str] = Field(default=None, max_length=160, title="Modelo por defecto")


class AiProviderCredentialUpdate(ApiPatchSchema):
    """Actualización parcial de una credencial (owner-only).

    Solo se aplican los campos enviados. ``secret`` (si viene) reemplaza y recifra
    el secreto; nunca se devuelve. ``provider`` es inmutable (no se declara).
    """

    label: Optional[str] = Field(default=None, min_length=1, max_length=120)
    secret: Optional[str] = Field(default=None, min_length=1)
    default_model: Optional[str] = Field(default=None, max_length=160)
    is_active: Optional[bool] = Field(default=None)


class AiProviderCredentialRead(ApiReadSchema):
    """Representación pública de una credencial. NUNCA expone el secreto en claro."""

    id: uuid.UUID
    provider: AiProvider
    credential_type: AiCredentialType
    label: str
    is_active: bool
    default_model: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
