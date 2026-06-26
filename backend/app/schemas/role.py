import uuid
from datetime import datetime
from typing import Optional

from pydantic import Field

from backend.app.schemas.base import ApiPatchSchema, ApiReadSchema, ApiWriteSchema


class PermissionRead(ApiReadSchema):
    access: str
    label: str
    description: Optional[str] = None


class PermissionGroupRead(ApiReadSchema):
    name: str
    label: str
    permissions: list[PermissionRead]


class RoleCreate(ApiWriteSchema):
    name: str = Field(
        min_length=1,
        max_length=100,
        title="Nombre",
        json_schema_extra={"ui": {"form": True, "widget": "text"}},
    )
    description: Optional[str] = Field(
        default=None,
        title="Descripción",
        json_schema_extra={"ui": {"form": True, "widget": "textarea"}},
    )
    # ``permissions`` se acepta opcionalmente pero NO se proyecta en el formulario
    # de capabilities de Commit 3: el catálogo de permisos es agrupado y aún no hay
    # contrato de opciones/relaciones. La asignación se resolverá en un commit posterior.
    permissions: list[str] = Field(default_factory=list)


class RoleUpdate(ApiPatchSchema):
    name: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=100,
        title="Nombre",
        json_schema_extra={"ui": {"form": True, "widget": "text"}},
    )
    description: Optional[str] = Field(
        default=None,
        title="Descripción",
        json_schema_extra={"ui": {"form": True, "widget": "textarea"}},
    )
    is_active: Optional[bool] = Field(
        default=None,
        title="Activo",
        json_schema_extra={"ui": {"form": True, "widget": "switch"}},
    )


class RolePermissionsReplace(ApiWriteSchema):
    """Reemplazo completo de permisos asignados a un rol (PUT)."""

    permissions: list[str]


class RolePermissionsRead(ApiReadSchema):
    """Selección actual de permisos de un rol (lectura para el editor relacional)."""

    permissions: list[str]


class RoleRead(ApiReadSchema):
    id: uuid.UUID
    name: str
    description: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None


class RoleListItem(RoleRead):
    """Versión de listado compatible con ``ResourceQuery``.

    Redeclara los campos visibles en lista con metadata UI explícita. ``id`` se
    hereda sin ``ui`` y por tanto no se proyecta como columna por defecto.
    """

    name: str = Field(title="Nombre", json_schema_extra={"ui": {"list": True}})
    description: Optional[str] = Field(
        default=None, title="Descripción", json_schema_extra={"ui": {"list": True}}
    )
    is_active: bool = Field(
        title="Activo",
        json_schema_extra={
            "ui": {
                "list": True,
                "filter": {
                    "operator": "eq",
                    "label": "Estado",
                    "widget": "select",
                    "options": [
                        {"value": "true", "label": "Activos"},
                        {"value": "false", "label": "Inactivos"},
                    ],
                },
            }
        },
    )
    created_at: datetime = Field(title="Creado", json_schema_extra={"ui": {"list": True}})
    updated_at: Optional[datetime] = Field(
        default=None, title="Actualizado", json_schema_extra={"ui": {"list": True}}
    )


class RoleDetailRead(RoleRead):
    """Detalle de rol incluyendo los permisos asignados."""

    permissions: list[str]
