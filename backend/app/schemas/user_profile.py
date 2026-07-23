import uuid
from datetime import datetime
from typing import Optional

from pydantic import EmailStr, Field, SecretStr

from backend.app.schemas.base import ApiPatchSchema, ApiReadSchema, ApiWriteSchema
from backend.app.schemas.user import PasswordConfirmMixin


class UserProfileRead(ApiReadSchema):
    """Datos propios visibles para el usuario autenticado."""

    id: uuid.UUID
    name: str
    last_name: str
    email: EmailStr
    created_at: datetime
    updated_at: Optional[datetime] = None


class UserProfileUpdate(ApiPatchSchema):
    """Campos que el usuario puede editar sobre su propio perfil."""

    name: Optional[str] = Field(default=None, min_length=4, max_length=50)
    last_name: Optional[str] = Field(default=None, min_length=4, max_length=50)
    email: Optional[EmailStr] = None


class UserPasswordChangeRequest(PasswordConfirmMixin, ApiWriteSchema):
    """Cambio de contraseña solicitado por el propio usuario."""

    current_password: SecretStr = Field(..., min_length=1, max_length=128)
    password: SecretStr = Field(..., min_length=8, max_length=128)
    confirm_password: SecretStr = Field(..., min_length=8, max_length=128)
