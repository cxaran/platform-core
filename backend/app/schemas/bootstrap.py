from pydantic import EmailStr, Field, SecretStr, field_validator, model_validator
from typing_extensions import Self

from backend.app.bootstrap.service import MAX_ADDITIONAL_ROLES
from backend.app.core.runtime_origins import normalize_base_url
from backend.app.schemas.base import ApiReadSchema, ApiWriteSchema
from backend.app.schemas.user import validate_password


class BootstrapStatusRead(ApiReadSchema):
    setup_required: bool
    token_required: bool


class BootstrapPermissionRead(ApiReadSchema):
    access: str
    label: str
    description: str | None = None


class BootstrapPermissionGroupRead(ApiReadSchema):
    name: str
    label: str
    permissions: list[BootstrapPermissionRead]


class BootstrapLimitsRead(ApiReadSchema):
    max_additional_roles: int


class BootstrapCatalogRead(ApiReadSchema):
    permission_groups: list[BootstrapPermissionGroupRead]
    limits: BootstrapLimitsRead


class BootstrapInitialUser(ApiWriteSchema):
    name: str = Field(min_length=4, max_length=50)
    last_name: str = Field(min_length=4, max_length=50)
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


class BootstrapSystemAdminRole(ApiWriteSchema):
    label: str = Field(default="Administrador de plataforma", min_length=1, max_length=100)
    description: str | None = Field(
        default="Administración inicial de la plataforma",
        max_length=500,
    )


class BootstrapAdditionalRole(ApiWriteSchema):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    permissions: list[str] = Field(default_factory=list)
    assign_to_initial_user: bool = False


class BootstrapInitializeRequest(ApiWriteSchema):
    user: BootstrapInitialUser
    system_admin_role: BootstrapSystemAdminRole = Field(default_factory=BootstrapSystemAdminRole)
    additional_roles: list[BootstrapAdditionalRole] = Field(
        default_factory=list,
        max_length=MAX_ADDITIONAL_ROLES,
    )
    # Política inicial de la plataforma (editable después en Configuración del
    # sistema). El bootstrap NUNCA recibe secretos de terceros: esas integraciones
    # se configuran autenticado y auditado, en el checklist post-bootstrap.
    app_base_url: str | None = Field(
        default=None,
        max_length=200,
        description=(
            "Dominio público (origen) de la instalación, p. ej. https://mi-dominio.com. "
            "Se persiste en la configuración del sistema y habilita las mutaciones "
            "autenticadas por cookie desde ese origen (guard CSRF). El asistente lo "
            "propone desde la URL actual; verifícalo antes de enviar."
        ),
    )
    public_registration_enabled: bool = Field(
        default=False,
        description="Permitir el auto-registro público desde el primer momento.",
    )
    password_reset_enabled: bool = Field(
        default=True,
        description="Permitir la recuperación de contraseña por correo.",
    )
    institution_name: str | None = Field(
        default=None,
        min_length=1,
        max_length=200,
        description="Nombre de la institución (opcional).",
    )
    @field_validator("app_base_url")
    def validate_app_base_url(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        normalized = normalize_base_url(value)
        if normalized is None:
            raise ValueError(
                "Debe ser un origen http(s) sin ruta ni credenciales, p. ej. https://mi-dominio.com"
            )
        return normalized

    customer_session_days: int | None = Field(
        default=None,
        ge=1,
        le=365,
        description=(
            "Días de sesión del cliente (sin roles). Vacío = default del "
            "despliegue. Editable después en Configuración del sistema."
        ),
    )
    staff_session_minutes: int | None = Field(
        default=None,
        ge=5,
        le=1440,
        description=(
            "Minutos de sesión del personal (con roles). Vacío = default del "
            "despliegue. Editable después en Configuración del sistema."
        ),
    )


class BootstrapInitializeRead(ApiReadSchema):
    setup_complete: bool
