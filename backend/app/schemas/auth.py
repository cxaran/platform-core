from pydantic import BaseModel, EmailStr, Field, SecretStr, field_validator, model_validator
from typing_extensions import Self

from backend.app.schemas.user import validate_password


class LoginRequest(BaseModel):
    email: EmailStr
    password: SecretStr


class RegisterRequest(BaseModel):
    email: EmailStr


class UnlockAccountRequest(BaseModel):
    token: str = Field(..., min_length=10)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
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


class MessageResponse(BaseModel):
    message: str


class TokenPayload(BaseModel):
    sub: str
    exp: int
    iat: int
    jti: str
