import uuid
from datetime import datetime
from typing import Optional, Set

from pydantic import EmailStr, Field, SecretStr, field_validator, model_validator
from typing_extensions import Self

from backend.app.schemas.base import ApiReadSchema


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


def validate_password(password: SecretStr) -> SecretStr:
    """Valida que la contraseña cumpla reglas de seguridad."""
    pw = password.get_secret_value()

    if not any(c.islower() for c in pw):
        raise ValueError("La contraseña debe contener al menos una letra minúscula")

    if not any(c.isdigit() for c in pw):
        raise ValueError("La contraseña debe contener al menos un número")

    return password


class PasswordConfirmMixin:
    """Valida el par ``password``/``confirm_password`` de un schema de escritura.

    Los campos se declaran en el schema (el mixin solo aporta los validadores,
    por eso ``check_fields=False``): reglas de seguridad + coincidencia.
    """

    @field_validator("password", check_fields=False)
    def _password_rules(cls, value: SecretStr) -> SecretStr:
        return validate_password(value)

    @model_validator(mode="after")
    def _passwords_match(self) -> Self:
        if self.password != self.confirm_password:  # type: ignore[attr-defined]
            raise ValueError("Las contraseñas no coinciden")
        return self


class PersonNameMixin:
    """Rechaza ``name``/``last_name`` de solo espacios (min_length no lo cubre)."""

    @field_validator("name", "last_name", check_fields=False)
    def _names_not_empty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("El nombre y apellido no pueden estar vacíos")
        return value


