from pydantic import BaseModel, EmailStr, Field, SecretStr, field_validator, model_validator
from typing_extensions import Annotated, Self

from backend.app.schemas.base import ApiReadSchema, ApiSchema, ApiWriteSchema
from backend.app.schemas.user import validate_password


class AuthPolicyRead(ApiReadSchema):
    """Política pública de auth que el frontend consume (no infiere de settings)."""

    registration_enabled: bool
    password_reset_enabled: bool
    # Botón "Continuar con Google" (efectivo: flag encendido Y credenciales completas).
    google_login_enabled: bool = False


class LoginRequest(ApiWriteSchema):
    email: EmailStr
    password: SecretStr


class LoginResponse(ApiSchema):
    """Desenlace del login: sesión creada o reto de verificación por correo."""

    message: str
    # True cuando el segundo paso está activo para este usuario: la sesión NO se
    # creó; el navegador debe verificar el código/enlace recibido por correo.
    verification_required: bool = False
    # Modo del reto (code | link) cuando verification_required es True.
    verification_mode: str | None = None


class LoginVerifyRequest(ApiWriteSchema):
    """Secreto del reto: el código de 6 dígitos o el token del enlace."""

    code: str = Field(min_length=1, max_length=200)


class RegisterRequest(ApiWriteSchema):
    email: EmailStr


class RegisterCompleteRequest(ApiWriteSchema):
    name: Annotated[str, Field(alias="first_name", min_length=4, max_length=50)]
    last_name: Annotated[str, Field(alias="last_name", min_length=4, max_length=50)]
    token: Annotated[str, Field(min_length=10)]
    email: EmailStr
    password: SecretStr = Field(..., min_length=8, max_length=128)
    confirm_password: SecretStr = Field(..., min_length=8, max_length=128)

    @field_validator("name", "last_name")
    def names_not_empty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("El nombre y apellido no pueden estar vacíos")
        return value

    @field_validator("password")
    def password_validator(cls, value: SecretStr) -> SecretStr:
        return validate_password(value)

    @model_validator(mode="after")
    def check_passwords_match(self) -> Self:
        if self.password != self.confirm_password:
            raise ValueError("Las contraseñas no coinciden")
        return self


class UnlockAccountRequest(ApiWriteSchema):
    token: str = Field(..., min_length=10)


class ForgotPasswordRequest(ApiWriteSchema):
    email: EmailStr


class ResetPasswordRequest(ApiWriteSchema):
    email: EmailStr
    token: str = Field(..., min_length=10)
    password: SecretStr = Field(..., min_length=8, max_length=128)
    confirm_password: SecretStr = Field(..., min_length=8, max_length=128)

    @field_validator("password")
    def password_validator(cls, value: SecretStr) -> SecretStr:
        return validate_password(value)

    @model_validator(mode="after")
    def check_passwords_match(self) -> Self:
        if self.password != self.confirm_password:
            raise ValueError("Las contraseñas no coinciden")
        return self


class MessageResponse(ApiSchema):
    message: str


class TokenPayload(BaseModel):
    sub: str
    exp: int
    iat: int
    jti: str
