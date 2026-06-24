import uuid
from datetime import datetime
from typing import Dict, Optional, Set

from fastapi import Form
from pydantic import (
    EmailStr,
    SecretStr,
    Field,
    field_validator,
    model_validator,
)
from typing_extensions import Annotated, Self

from backend.app.schemas.base import ApiPatchSchema, ApiReadSchema, ApiWriteSchema


# Usuario autenticado en sesión (no es un XBase de dominio: lleva permisos y la
# lógica de control de acceso usada por las dependencias de auth).
class SessionUser(ApiReadSchema):
    id: uuid.UUID
    name: str
    last_name: str
    email: EmailStr
    permissions: Set[str] = Field(default_factory=set)

    def access_control(self, access: str) -> bool:
        return access in self.permissions


class UserRead(ApiReadSchema):
    """Representación pública completa de un usuario."""

    id: uuid.UUID
    name: str
    last_name: str
    email: EmailStr
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None


class UserListItem(ApiReadSchema):
    """Versión reducida para listados de usuarios."""

    id: uuid.UUID
    name: str
    last_name: str
    email: EmailStr
    is_active: bool
    created_at: datetime


class UserUpdate(ApiPatchSchema):
    """Actualización parcial de un usuario (PATCH)."""

    name: Optional[str] = Field(default=None, min_length=4, max_length=50)
    last_name: Optional[str] = Field(default=None, min_length=4, max_length=50)
    email: Optional[EmailStr] = None
    is_active: Optional[bool] = None



# Auxiliar para validar la contraseña
def validate_password(password: SecretStr) -> SecretStr:
    """Valida que la contraseña cumpla reglas de seguridad."""
    pw = password.get_secret_value()

    # if not any(c.isupper() for c in pw):
    #     raise ValueError("La contraseña debe contener al menos una letra mayúscula")

    if not any(c.islower() for c in pw):
        raise ValueError("La contraseña debe contener al menos una letra minúscula")

    if not any(c.isdigit() for c in pw):
        raise ValueError("La contraseña debe contener al menos un número")

    return password


class UserCreate(ApiWriteSchema):
    """Esquema para crear un nuevo usuario con validaciones."""

    name: Annotated[str, Field(alias="first_name", min_length=4, max_length=50)]
    last_name: Annotated[str, Field(alias="last_name", min_length=4, max_length=50)]
    token: Annotated[str, Field(min_length=10)]
    email: EmailStr
    password: SecretStr = Field(..., min_length=8, max_length=128)
    confirm_password: SecretStr = Field(..., min_length=8, max_length=128)

    @field_validator("name", "last_name")
    def names_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("El nombre y apellido no pueden estar vacíos")
        return v

    @field_validator("password")
    def password_validator(cls, v: SecretStr) -> SecretStr:
        return validate_password(v)

    # Valida que confirm_password coincida con password
    @model_validator(mode="after")
    def check_passwords_match(self) -> Self:
        if self.password != self.confirm_password:
            raise ValueError("Las contraseñas no coinciden")
        return self

    @classmethod
    def from_form(
        cls,
        name: Optional[str] = Form(None),
        last_name: Optional[str] = Form(None),
        token: Optional[str] = Form(None),
        email: Optional[str] = Form(None),
        password: Optional[str] = Form(None),
        confirm_password: Optional[str] = Form(None),
    ) -> Dict[str, Optional[str]]:
        """
        Devuelve un dict con los valores del form (todos opcionales).
        No valida nada: la validación se hace explícitamente en el endpoint.
        """
        return {
            "name": name,
            "last_name": last_name,
            "token": token,
            "email": email,
            "password": password,
            "confirm_password": confirm_password,
        }


class UserResetPassword(ApiWriteSchema):
    """Esquema para restablecer la contraseña de un usuario con validaciones."""

    token: Annotated[str, Field(min_length=10)]
    email: EmailStr
    password: SecretStr = Field(..., min_length=6, max_length=128)
    confirm_password: SecretStr = Field(..., min_length=6, max_length=128)

    @field_validator("password")
    def password_validator(cls, v: SecretStr) -> SecretStr:
        return validate_password(v)

    # Valida que confirm_password coincida con password
    @model_validator(mode="after")
    def check_passwords_match(self) -> Self:
        if self.password != self.confirm_password:
            raise ValueError("Las contraseñas no coinciden")
        return self

    @classmethod
    def from_form(
        cls,
        token: Optional[str] = Form(None),
        email: Optional[str] = Form(None),
        password: Optional[str] = Form(None),
        confirm_password: Optional[str] = Form(None),
    ) -> Dict[str, Optional[str]]:
        """
        Devuelve un dict con los valores del form (todos opcionales).
        No valida nada: la validación se hace explícitamente en el endpoint.
        """
        return {
            "token": token,
            "email": email,
            "password": password,
            "confirm_password": confirm_password,
        }


