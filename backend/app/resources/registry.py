"""Registro neutral de recursos navegables de primer nivel.

Fuente única de las instancias ``ResourceQuery`` reutilizables (compartidas con los
routers) y de la metadata declarativa por recurso (label, ``api_path``, schemas por
operación, permisos por operación, acciones y orden de catálogo).

No importa routers ni la proyección: routers y proyección importan de aquí. Esto
evita ciclos y mantiene una sola definición de ``QueryOptions`` por recurso.
"""

from dataclasses import dataclass
from typing import Optional

from pydantic import BaseModel

from backend.app.models.user import Role, User
from backend.app.query import QueryOptions, ResourceQuery
from backend.app.schemas.capabilities import (
    ActionScope,
    HttpMethod,
    OptionsSourceType,
    RelationCardinality,
    ResourceView,
)
from backend.app.schemas.role import RoleCreate, RoleListItem, RoleRead, RoleUpdate
from backend.app.schemas.user_admin import (
    UserAdminCreate,
    UserAdminListItem,
    UserAdminUpdate,
)
from backend.app.security.groups.permissions import PermissionPermissions
from backend.app.security.groups.roles import RolePermissions
from backend.app.security.groups.users import UserPermissions
from backend.app.security.security_group import SecurityGroup

# --- Instancias de query compartidas (movidas desde los routers) ---

USERS = ResourceQuery(
    name="UserAdminQuery",
    model=User,
    schema=UserAdminListItem,
    options=QueryOptions(
        filter_fields=("is_active", "email"),
        sort_fields=("created_at", "name", "email"),
        search_fields=("name", "email"),
        in_fields=("id",),
        default_sort="-created_at",
    ),
)

USER_ROLES = ResourceQuery(
    name="UserRoleQuery",
    model=Role,
    schema=RoleRead,
    options=QueryOptions(
        filter_fields=("is_active", "name"),
        sort_fields=("name", "created_at"),
        search_fields=("name",),
        in_fields=("id",),
        default_sort="name",
    ),
)

ROLES = ResourceQuery(
    name="RoleQuery",
    model=Role,
    schema=RoleListItem,
    options=QueryOptions(
        filter_fields=("is_active", "name"),
        sort_fields=("created_at", "name"),
        search_fields=("name",),
        in_fields=("id",),
        default_sort="name",
    ),
)


@dataclass(frozen=True)
class ConfirmationDef:
    """Confirmación declarada de una acción (diálogo accesible en el frontend)."""

    title: str
    message: str
    confirm_label: str
    destructive: bool
    required: bool = True


@dataclass(frozen=True)
class ActionDef:
    """Acción declarada de un recurso. ``permission`` es un control de seguridad
    existente (miembro de ``SecurityGroup``); se filtra con ``.check(current_user)``.

    ``fixed_body`` declara el cuerpo exacto que el frontend debe enviar (p. ej.
    ``{"is_active": False}`` para reutilizar el PATCH de actualización como
    desactivación). El frontend no puede modificarlo ni reutilizar la acción para
    otro payload."""

    name: str
    label: str
    method: HttpMethod
    url_template: str
    scope: ActionScope
    danger: bool
    permission: SecurityGroup
    fixed_body: Optional[dict[str, object]] = None
    confirmation: Optional[ConfirmationDef] = None


@dataclass(frozen=True)
class RelationDef:
    """Editor relacional declarado de un recurso (reemplazo atómico de una M2M).

    Las URLs son plantillas con ``{id}`` del recurso dueño. ``permission`` es el
    control que habilita **editar** la relación: la capability solo se proyecta si
    el actor lo cumple (además del permiso de lectura del recurso). El backend sigue
    siendo la autoridad: supervivencia administrativa e invalidación de sesiones se
    aplican en la mutación, no en la UI."""

    name: str
    label: str
    description: Optional[str]
    cardinality: RelationCardinality
    required: bool
    selection_url_template: str
    # Campo de la respuesta de ``selection_url`` que contiene la lista de valores
    # actualmente seleccionados. Si es ``None``, la selección es una página
    # (``items[]``) y el valor de cada item se lee con ``options_value_field``.
    selection_field: Optional[str]
    mutation_method: HttpMethod
    mutation_url_template: str
    request_field: str
    options_type: OptionsSourceType
    options_url: str
    options_value_field: str
    options_label_field: str
    permission: SecurityGroup


@dataclass(frozen=True)
class ResourceDefinition:
    name: str
    label: str
    api_path: str
    view: ResourceView
    read_permission: SecurityGroup
    list_query: Optional[ResourceQuery] = None
    list_schema: Optional[type[BaseModel]] = None
    create_schema: Optional[type[BaseModel]] = None
    update_schema: Optional[type[BaseModel]] = None
    create_permission: Optional[SecurityGroup] = None
    update_permission: Optional[SecurityGroup] = None
    # Lectura individual: si está declarada, el recurso publica ``item_reference`` y
    # ``detail``. El campo identificador (``item_id_field``) coincide con el token
    # ``{id}`` de las plantillas de URL (detail, update, acciones).
    detail_url_template: Optional[str] = None
    item_id_field: str = "id"
    actions: tuple[ActionDef, ...] = ()
    relations: tuple[RelationDef, ...] = ()


RESOURCE_REGISTRY: tuple[ResourceDefinition, ...] = (
    ResourceDefinition(
        name="users",
        label="Usuarios",
        api_path="/api/v1/users",
        view=ResourceView.TABLE,
        read_permission=UserPermissions.READ,
        list_query=USERS,
        list_schema=UserAdminListItem,
        create_schema=UserAdminCreate,
        update_schema=UserAdminUpdate,
        create_permission=UserPermissions.CREATE,
        update_permission=UserPermissions.UPDATE,
        detail_url_template="/api/v1/users/{id}",
        actions=(
            # Activate/deactivate reutilizan el PATCH de actualización con un cuerpo
            # fijo: la supervivencia administrativa y la invalidación de sesiones ya
            # viven ahí, sin endpoints nuevos que dupliquen reglas.
            ActionDef(
                name="activate",
                label="Activar",
                method=HttpMethod.PATCH,
                url_template="/api/v1/users/{id}",
                scope=ActionScope.ITEM,
                danger=False,
                permission=UserPermissions.UPDATE,
                fixed_body={"is_active": True},
                confirmation=ConfirmationDef(
                    title="Activar usuario",
                    message="El usuario recuperará acceso a la plataforma.",
                    confirm_label="Activar",
                    destructive=False,
                    required=False,
                ),
            ),
            ActionDef(
                name="deactivate",
                label="Desactivar",
                method=HttpMethod.PATCH,
                url_template="/api/v1/users/{id}",
                scope=ActionScope.ITEM,
                danger=True,
                permission=UserPermissions.UPDATE,
                fixed_body={"is_active": False},
                confirmation=ConfirmationDef(
                    title="Desactivar usuario",
                    message="El usuario perderá acceso inmediatamente.",
                    confirm_label="Desactivar",
                    destructive=True,
                ),
            ),
            ActionDef(
                name="revoke_sessions",
                label="Revocar sesiones",
                method=HttpMethod.POST,
                url_template="/api/v1/users/{id}/revoke-sessions",
                scope=ActionScope.ITEM,
                danger=True,
                permission=UserPermissions.REVOKE_SESSIONS,
                confirmation=ConfirmationDef(
                    title="Revocar sesiones",
                    message="Se cerrarán todas las sesiones activas del usuario.",
                    confirm_label="Revocar",
                    destructive=True,
                ),
            ),
            ActionDef(
                name="delete",
                label="Eliminar",
                method=HttpMethod.DELETE,
                url_template="/api/v1/users/{id}",
                scope=ActionScope.ITEM,
                danger=True,
                permission=UserPermissions.DELETE,
                confirmation=ConfirmationDef(
                    title="Eliminar usuario",
                    message="El usuario será desactivado y perderá acceso.",
                    confirm_label="Eliminar",
                    destructive=True,
                ),
            ),
        ),
        relations=(
            RelationDef(
                name="roles",
                label="Roles",
                description="Roles asignados al usuario",
                cardinality=RelationCardinality.MULTIPLE,
                required=False,
                selection_url_template="/api/v1/users/{id}/roles",
                selection_field=None,
                mutation_method=HttpMethod.PUT,
                mutation_url_template="/api/v1/users/{id}/roles",
                request_field="role_ids",
                options_type=OptionsSourceType.LIST,
                options_url="/api/v1/roles",
                options_value_field="id",
                options_label_field="name",
                permission=UserPermissions.MANAGE_ROLES,
            ),
        ),
    ),
    ResourceDefinition(
        name="roles",
        label="Roles",
        api_path="/api/v1/roles",
        view=ResourceView.TABLE,
        read_permission=RolePermissions.READ,
        list_query=ROLES,
        list_schema=RoleListItem,
        create_schema=RoleCreate,
        update_schema=RoleUpdate,
        create_permission=RolePermissions.CREATE,
        update_permission=RolePermissions.UPDATE,
        detail_url_template="/api/v1/roles/{id}",
        actions=(
            ActionDef(
                name="activate",
                label="Activar",
                method=HttpMethod.PATCH,
                url_template="/api/v1/roles/{id}",
                scope=ActionScope.ITEM,
                danger=False,
                permission=RolePermissions.UPDATE,
                fixed_body={"is_active": True},
                confirmation=ConfirmationDef(
                    title="Activar rol",
                    message="El rol y sus permisos volverán a estar disponibles.",
                    confirm_label="Activar",
                    destructive=False,
                    required=False,
                ),
            ),
            ActionDef(
                name="deactivate",
                label="Desactivar",
                method=HttpMethod.PATCH,
                url_template="/api/v1/roles/{id}",
                scope=ActionScope.ITEM,
                danger=True,
                permission=RolePermissions.UPDATE,
                fixed_body={"is_active": False},
                confirmation=ConfirmationDef(
                    title="Desactivar rol",
                    message="Los usuarios con este rol perderán sus permisos.",
                    confirm_label="Desactivar",
                    destructive=True,
                ),
            ),
            ActionDef(
                name="delete",
                label="Eliminar",
                method=HttpMethod.DELETE,
                url_template="/api/v1/roles/{id}",
                scope=ActionScope.ITEM,
                danger=True,
                permission=RolePermissions.DELETE,
                confirmation=ConfirmationDef(
                    title="Eliminar rol",
                    message="El rol será desactivado y dejará de aplicarse.",
                    confirm_label="Eliminar",
                    destructive=True,
                ),
            ),
        ),
        relations=(
            RelationDef(
                name="permissions",
                label="Permisos",
                description="Permisos asignados al rol",
                cardinality=RelationCardinality.MULTIPLE,
                required=False,
                selection_url_template="/api/v1/roles/{id}/permissions",
                selection_field="permissions",
                mutation_method=HttpMethod.PUT,
                mutation_url_template="/api/v1/roles/{id}/permissions",
                request_field="permissions",
                options_type=OptionsSourceType.GROUPED_CATALOG,
                options_url="/api/v1/permissions",
                options_value_field="access",
                options_label_field="label",
                permission=RolePermissions.MANAGE_PERMISSIONS,
            ),
        ),
    ),
    ResourceDefinition(
        name="permissions",
        label="Permisos",
        api_path="/api/v1/permissions",
        view=ResourceView.GROUPED_CATALOG,
        read_permission=PermissionPermissions.READ,
    ),
)


def get_resource(name: str) -> Optional[ResourceDefinition]:
    for definition in RESOURCE_REGISTRY:
        if definition.name == name:
            return definition
    return None
