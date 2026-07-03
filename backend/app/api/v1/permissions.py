"""Catálogo agrupado de permisos, autenticado y protegido por RBAC.

Fuente de opciones para la administración normal (editor de permisos de roles) y
para la vista ``grouped_catalog``. No reutiliza ``/bootstrap/catalog``, que solo
existe durante la instalación inicial."""

from fastapi import APIRouter

from backend.app.schemas.role import PermissionGroupRead, PermissionRead
from backend.app.security.catalog import SECURITY_GROUPS
from backend.app.security.groups.permissions import PermissionPermissions

router = APIRouter(prefix="/permissions", tags=["permissions"])


@router.get("", response_model=list[PermissionGroupRead])
def list_permissions(
    _: PermissionPermissions.READ.requiere,
) -> list[PermissionGroupRead]:
    groups: list[PermissionGroupRead] = []
    for group in SECURITY_GROUPS:
        groups.append(
            PermissionGroupRead(
                name=group.group_name(),
                label=group.group_label(),
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
