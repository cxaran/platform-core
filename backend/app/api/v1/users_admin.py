"""Administración de usuarios."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, status

from backend.app.api.resource_actions import (
    commit_with_admin_survival,
    create_entity,
    deactivate_entity,
    get_or_404,
    paginate_resource,
    patch_entity,
    related_stmt,
    replace_to_many,
    serialize,
    serialize_many,
    update_entity_values,
)
from backend.app.auth.auth_dependencies import CurrentUser
from backend.app.auth.security import generate_token, get_password_hash
from backend.app.core.database import SessionDep
from backend.app.models.user import Role, User, UserRole
from backend.app.resources.registry import USER_ROLES, USERS
from backend.app.schemas.pagination import OffsetPage
from backend.app.schemas.role import RoleRead
from backend.app.schemas.user_admin import (
    UserAdminCreate,
    UserAdminListItem,
    UserAdminRead,
    UserAdminUpdate,
    UserRolesReplace,
)
from backend.app.security.groups.users import UserPermissions
from backend.app.security.session_invalidation import invalidate_user_sessions

router = APIRouter(prefix="/users", tags=["users-admin"])


@router.get("", response_model=OffsetPage[UserAdminListItem])
def list_users(
    session: SessionDep,
    query: Annotated[USERS.Query, Query()],  # pyright: ignore[reportInvalidTypeForm]
    _: UserPermissions.READ.requiere,
) -> OffsetPage[UserAdminListItem]:
    return paginate_resource(USERS, session, query)


@router.get("/{user_id}", response_model=UserAdminRead)
def get_user(
    user_id: UUID,
    session: SessionDep,
    _: UserPermissions.READ.requiere,
) -> UserAdminRead:
    user = get_or_404(session, User, user_id, "Usuario no encontrado")
    return serialize(UserAdminRead, user)


@router.post("", response_model=UserAdminRead, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserAdminCreate,
    session: SessionDep,
    current_user: CurrentUser,
    _: UserPermissions.CREATE.requiere,
) -> UserAdminRead:
    user = create_entity(
        session,
        User,
        payload,
        exclude={"password", "confirm_password"},
        values={
            "hashed_password": get_password_hash(payload.password),
            "token": generate_token(),
            "updated_by": current_user.id,
        },
        conflict_message="Ya existe un usuario con ese email",
    )
    return serialize(UserAdminRead, user)


@router.patch("/{user_id}", response_model=UserAdminRead)
def update_user(
    user_id: UUID,
    payload: UserAdminUpdate,
    session: SessionDep,
    current_user: CurrentUser,
    _: UserPermissions.UPDATE.requiere,
) -> UserAdminRead:
    user = get_or_404(session, User, user_id, "Usuario no encontrado")
    user = patch_entity(
        session,
        user,
        payload,
        actor_id=current_user.id,
        rotate_token_fields=("email",),
        token_factory=generate_token,
        commit=False,
        conflict_message="Ya existe un usuario con ese email",
    )
    # Desactivar a un usuario invalida sus sesiones; la baja se valida contra la
    # supervivencia administrativa dentro de la misma transacción.
    if payload.is_active is False:
        invalidate_user_sessions(user, actor_id=current_user.id)
    commit_with_admin_survival(
        session, conflict_message="Ya existe un usuario con ese email"
    )
    return serialize(UserAdminRead, user)


@router.delete("/{user_id}", response_model=UserAdminRead)
def delete_user(
    user_id: UUID,
    session: SessionDep,
    current_user: CurrentUser,
    _: UserPermissions.DELETE.requiere,
) -> UserAdminRead:
    user = get_or_404(session, User, user_id, "Usuario no encontrado")
    # ``token_factory`` rota el token al desactivar: invalida las sesiones del usuario.
    user = deactivate_entity(
        session,
        user,
        actor_id=current_user.id,
        token_factory=generate_token,
        commit=False,
        inactive_message="El usuario ya está desactivado",
    )
    commit_with_admin_survival(
        session,
        conflict_message="El usuario ya está desactivado",
        conflict_code="resource_state_conflict",
    )
    return serialize(UserAdminRead, user)


@router.get("/{user_id}/roles", response_model=OffsetPage[RoleRead])
def list_user_roles(
    user_id: UUID,
    session: SessionDep,
    query: Annotated[USER_ROLES.Query, Query()],  # pyright: ignore[reportInvalidTypeForm]
    _: UserPermissions.MANAGE_ROLES.requiere,
) -> OffsetPage[RoleRead]:
    get_or_404(session, User, user_id, "Usuario no encontrado")
    stmt = related_stmt(
        Role, UserRole, owner_field="user_id", owner_id=user_id, target_field="role_id"
    )
    return paginate_resource(USER_ROLES, session, query, stmt=stmt)


@router.put("/{user_id}/roles", response_model=list[RoleRead])
def replace_user_roles(
    user_id: UUID,
    payload: UserRolesReplace,
    session: SessionDep,
    current_user: CurrentUser,
    _: UserPermissions.MANAGE_ROLES.requiere,
) -> list[RoleRead]:
    user = get_or_404(session, User, user_id, "Usuario no encontrado")
    roles = replace_to_many(
        session,
        UserRole,
        owner_field="user_id",
        owner_id=user_id,
        target_model=Role,
        target_field="role_id",
        target_ids=payload.role_ids,
        actor_id=current_user.id,
        touch=user,
        commit=False,
        missing_message="Rol no encontrado",
    )
    # Cambiar los roles altera la cobertura efectiva del usuario: se invalidan sus
    # sesiones y se valida la supervivencia antes de confirmar.
    invalidate_user_sessions(user, actor_id=current_user.id)
    commit_with_admin_survival(
        session,
        conflict_message="Conflicto al reemplazar la relación",
        conflict_code="relation_conflict",
    )
    return serialize_many(RoleRead, roles)


@router.post("/{user_id}/revoke-sessions", response_model=UserAdminRead)
def revoke_user_sessions(
    user_id: UUID,
    session: SessionDep,
    current_user: CurrentUser,
    _: UserPermissions.REVOKE_SESSIONS.requiere,
) -> UserAdminRead:
    user = get_or_404(session, User, user_id, "Usuario no encontrado")
    user = update_entity_values(
        session,
        user,
        {"token": generate_token()},
        actor_id=current_user.id,
        conflict_message="No se pudo revocar las sesiones del usuario",
    )
    return serialize(UserAdminRead, user)
