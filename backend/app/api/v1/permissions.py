"""Catálogo agrupado de permisos, autenticado y protegido por RBAC.

Fuente de opciones para la administración normal (editor de permisos de roles) y
para la vista ``grouped_catalog``. No reutiliza ``/bootstrap/catalog``, que solo
existe durante la instalación inicial."""

from fastapi import APIRouter

from backend.app.schemas.role import PermissionGroupRead, PermissionRead
from backend.app.security.catalog import SECURITY_GROUPS
from backend.app.security.groups.permissions import PermissionPermissions
from backend.app.security.security_group import SecurityGroup

router = APIRouter(prefix="/permissions", tags=["permissions"])

_GROUP_LABELS = {
    "users": "Usuarios",
    "roles": "Roles",
    "permissions": "Permisos",
}


def _group_name(group: type[SecurityGroup]) -> str:
    singular = group.__name__.removesuffix("Permissions").lower()
    return {"user": "users", "role": "roles", "permission": "permissions"}.get(
        singular, singular
    )


@router.get("", response_model=list[PermissionGroupRead])
def list_permissions(
    _: PermissionPermissions.READ.requiere,
) -> list[PermissionGroupRead]:
    groups: list[PermissionGroupRead] = []
    for group in SECURITY_GROUPS:
        name = _group_name(group)
        groups.append(
            PermissionGroupRead(
                name=name,
                label=_GROUP_LABELS.get(name, name.capitalize()),
                permissions=[
                    PermissionRead(
                        access=permission.permission,
                        label=permission.description or permission.permission,
                        description=permission.description,
                    )
                    for permission in group
                ],
            )
        )
    return groups
