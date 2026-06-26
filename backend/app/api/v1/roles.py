"""Administración de roles y sus permisos."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, status

from backend.app.api.resource_actions import (
    commit_with_admin_survival,
    create_entity,
    deactivate_entity,
    ensure_allowed_values,
    get_or_404,
    list_child_values,
    paginate_resource,
    patch_entity,
    replace_child_values,
    serialize,
    serialize_with,
)
from backend.app.auth.auth_dependencies import CurrentUser
from backend.app.core.database import SessionDep
from backend.app.models.user import Role, RoleAccess
from backend.app.resources.registry import ROLES
from backend.app.schemas.pagination import OffsetPage
from backend.app.schemas.role import (
    RoleCreate,
    RoleDetailRead,
    RoleListItem,
    RolePermissionsRead,
    RolePermissionsReplace,
    RoleRead,
    RoleUpdate,
)
from backend.app.security.catalog import declared_permissions
from backend.app.security.groups.roles import RolePermissions
from backend.app.security.session_invalidation import invalidate_role_members_sessions

router = APIRouter(prefix="/roles", tags=["roles"])

DECLARED_PERMISSIONS = declared_permissions()


@router.get("", response_model=OffsetPage[RoleListItem])
def list_roles(
    session: SessionDep,
    query: Annotated[ROLES.Query, Query()],  # pyright: ignore[reportInvalidTypeForm]
    _: RolePermissions.READ.requiere,
) -> OffsetPage[RoleListItem]:
    return paginate_resource(ROLES, session, query)


@router.get("/{role_id}", response_model=RoleDetailRead)
def get_role(
    role_id: UUID,
    session: SessionDep,
    _: RolePermissions.READ.requiere,
) -> RoleDetailRead:
    role = get_or_404(session, Role, role_id, "Rol no encontrado")
    permissions = list_child_values(
        session, RoleAccess, owner_field="role_id", owner_id=role_id, value_field="access"
    )
    return serialize_with(RoleDetailRead, role, {"permissions": permissions})


@router.post("", response_model=RoleDetailRead, status_code=status.HTTP_201_CREATED)
def create_role(
    payload: RoleCreate,
    session: SessionDep,
    current_user: CurrentUser,
    _: RolePermissions.CREATE.requiere,
) -> RoleDetailRead:
    ensure_allowed_values(
        payload.permissions,
        DECLARED_PERMISSIONS,
        field="permissions",
        message="El rol contiene permisos no declarados",
        code="invalid_permission",
    )
    role = create_entity(
        session,
        Role,
        payload,
        exclude={"permissions"},
        values={"updated_by": current_user.id},
        conflict_message="Ya existe un rol con ese nombre",
    )
    permissions = replace_child_values(
        session,
        RoleAccess,
        owner_field="role_id",
        owner_id=role.id,
        value_field="access",
        values=payload.permissions,
        allowed_values=DECLARED_PERMISSIONS,
        actor_id=current_user.id,
        touch=role,
        invalid_message="El rol contiene permisos no declarados",
        invalid_code="invalid_permission",
    )
    return serialize_with(RoleDetailRead, role, {"permissions": permissions})


@router.patch("/{role_id}", response_model=RoleRead)
def update_role(
    role_id: UUID,
    payload: RoleUpdate,
    session: SessionDep,
    current_user: CurrentUser,
    _: RolePermissions.UPDATE.requiere,
) -> RoleRead:
    role = get_or_404(session, Role, role_id, "Rol no encontrado")
    role = patch_entity(
        session,
        role,
        payload,
        actor_id=current_user.id,
        commit=False,
        conflict_message="Ya existe un rol con ese nombre",
    )
    # Desactivar un rol cambia la cobertura de sus miembros: se invalidan sus sesiones.
    if payload.is_active is False:
        invalidate_role_members_sessions(session, role_id, actor_id=current_user.id)
    commit_with_admin_survival(
        session, conflict_message="Ya existe un rol con ese nombre"
    )
    return serialize(RoleRead, role)


@router.delete("/{role_id}", response_model=RoleRead)
def delete_role(
    role_id: UUID,
    session: SessionDep,
    current_user: CurrentUser,
    _: RolePermissions.DELETE.requiere,
) -> RoleRead:
    role = get_or_404(session, Role, role_id, "Rol no encontrado")
    role = deactivate_entity(
        session,
        role,
        actor_id=current_user.id,
        commit=False,
        inactive_message="El rol ya está desactivado",
    )
    invalidate_role_members_sessions(session, role_id, actor_id=current_user.id)
    commit_with_admin_survival(
        session,
        conflict_message="El rol ya está desactivado",
        conflict_code="resource_state_conflict",
    )
    return serialize(RoleRead, role)


@router.get("/{role_id}/permissions", response_model=RolePermissionsRead)
def get_role_permissions(
    role_id: UUID,
    session: SessionDep,
    _: RolePermissions.MANAGE_PERMISSIONS.requiere,
) -> RolePermissionsRead:
    """Selección actual de permisos del rol (lectura para el editor relacional)."""
    get_or_404(session, Role, role_id, "Rol no encontrado")
    permissions = list_child_values(
        session, RoleAccess, owner_field="role_id", owner_id=role_id, value_field="access"
    )
    return RolePermissionsRead(permissions=permissions)


@router.put("/{role_id}/permissions", response_model=RoleDetailRead)
def replace_role_permissions(
    role_id: UUID,
    payload: RolePermissionsReplace,
    session: SessionDep,
    current_user: CurrentUser,
    _: RolePermissions.MANAGE_PERMISSIONS.requiere,
) -> RoleDetailRead:
    role = get_or_404(session, Role, role_id, "Rol no encontrado")
    permissions = replace_child_values(
        session,
        RoleAccess,
        owner_field="role_id",
        owner_id=role_id,
        value_field="access",
        values=payload.permissions,
        allowed_values=DECLARED_PERMISSIONS,
        actor_id=current_user.id,
        touch=role,
        commit=False,
        invalid_message="El rol contiene permisos no declarados",
        invalid_code="invalid_permission",
    )
    # Cambiar los permisos del rol altera la cobertura de todos sus miembros activos.
    invalidate_role_members_sessions(session, role_id, actor_id=current_user.id)
    commit_with_admin_survival(
        session,
        conflict_message="Conflicto al reemplazar valores relacionados",
        conflict_code="relation_conflict",
    )
    return serialize_with(RoleDetailRead, role, {"permissions": permissions})
