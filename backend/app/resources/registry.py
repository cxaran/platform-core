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

from backend.app.models.audit_event import AuditEvent
from backend.app.models.backup import BackupRun, BackupSettings
from backend.app.models.system_settings import SystemSettings
from backend.app.models.user import Role, User
from backend.app.query import QueryOptions, ResourceQuery
from backend.app.query.operators import Operator

# Operadores de texto visibles compartidos por los campos de nombre/correo de los
# recursos administrativos (``eq`` se declara aparte vía ``filter_fields``).
_TEXT_FILTER_OPERATORS = (
    Operator.CONTAINS,
    Operator.STARTS_WITH,
    Operator.ENDS_WITH,
    Operator.NE,
)
# Operadores de fecha de calendario para ``created_at`` (día completo en la zona de
# aplicación). Solo se publican en usuarios y roles, no en permisos.
_CREATED_AT_OPERATORS = (
    Operator.ON,
    Operator.BEFORE,
    Operator.AFTER,
    Operator.BETWEEN,
)
from backend.app.schemas.capabilities import (
    ActionCondition,
    ActionScope,
    FormTransport,
    HttpMethod,
    OptionsSourceType,
    ResourceFileFieldCapability,
    ResourceView,
)
from backend.app.schemas.audit_event import AuditEventListItem
from backend.app.schemas.backup import (
    BackupRunListItem,
    BackupSettingsListItem,
    BackupSettingsUpdate,
)
from backend.app.schemas.role import RoleCreate, RoleListItem, RoleRead, RoleUpdate
from backend.app.schemas.system_settings import (
    SendTestEmailRequest,
    SystemSettingsListItem,
    SystemSettingsUpdate,
    VerifyDomainRequest,
)
from backend.app.schemas.user_admin import (
    UserAdminCreate,
    UserAdminListItem,
    UserAdminUpdate,
)
from backend.app.security.groups.audit_events import AuditEventPermissions
from backend.app.security.groups.backups import BackupPermissions
from backend.app.security.groups.permissions import PermissionPermissions
from backend.app.security.groups.roles import RolePermissions
from backend.app.security.groups.system_settings import SystemSettingsPermissions
from backend.app.security.groups.users import UserPermissions
from backend.app.security.security_group import SecurityGroup

# --- Instancias de query compartidas (movidas desde los routers) ---

USERS = ResourceQuery(
    name="UserAdminQuery",
    model=User,
    schema=UserAdminListItem,
    options=QueryOptions(
        filter_fields=("is_active", "email", "name"),
        sort_fields=("created_at", "name", "email"),
        search_fields=("name", "email"),
        in_fields=("id",),
        field_operators={
            "name": _TEXT_FILTER_OPERATORS,
            "email": _TEXT_FILTER_OPERATORS,
            "created_at": _CREATED_AT_OPERATORS,
        },
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
        field_operators={
            "name": _TEXT_FILTER_OPERATORS,
            "created_at": _CREATED_AT_OPERATORS,
        },
        default_sort="name",
    ),
)

BACKUP_SETTINGS = ResourceQuery(
    name="BackupSettingsQuery",
    model=BackupSettings,
    schema=BackupSettingsListItem,
    options=QueryOptions(
        # Singleton: la lista devuelve UNA fila; sin filtros ni búsqueda (no hay nada
        # que filtrar). El orden es irrelevante pero el contrato exige un default.
        sort_fields=("created_at",),
        in_fields=("id",),
        default_sort="created_at",
    ),
)

BACKUP_RUNS = ResourceQuery(
    name="BackupRunQuery",
    model=BackupRun,
    schema=BackupRunListItem,
    options=QueryOptions(
        # Historial operativo: filtro por estado (enum no nativo, igualdad) y rango de
        # calendario sobre created_at. Sin búsqueda libre (metadata, no texto).
        filter_fields=("status", "trigger_kind"),
        field_operators={"created_at": _CREATED_AT_OPERATORS},
        sort_fields=("created_at", "finished_at", "file_size_bytes"),
        in_fields=("id",),
        default_sort="-created_at",
    ),
)

SYSTEM_SETTINGS = ResourceQuery(
    name="SystemSettingsQuery",
    model=SystemSettings,
    schema=SystemSettingsListItem,
    options=QueryOptions(
        # Singleton: una fila; sin filtros ni búsqueda.
        sort_fields=("created_at",),
        in_fields=("id",),
        default_sort="created_at",
    ),
)

AUDIT_EVENTS = ResourceQuery(
    name="AuditEventQuery",
    model=AuditEvent,
    schema=AuditEventListItem,
    options=QueryOptions(
        # Bitácora append-only (sin baja lógica). Filtros por igualdad: ``actor_user_id``
        # (quién), ``action`` (qué acción), ``entity_type`` y ``entity_id`` (sobre qué
        # entidad — así se reconstruye el rastro de un registro concreto).
        # ``occurred_at`` (DateTime) admite rango de calendario. Orden por fecha
        # descendente por defecto. Sin búsqueda libre (la bitácora no es texto).
        filter_fields=("actor_user_id", "action", "entity_type", "entity_id"),
        field_operators={"occurred_at": _CREATED_AT_OPERATORS},
        sort_fields=("occurred_at",),
        in_fields=("id",),
        default_sort="-occurred_at",
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
    otro payload.

    ``input_schema`` declara, en su lugar, un formulario de entrada (un schema Pydantic
    con ``extra="forbid"``) que el frontend debe presentar y enviar. ``fixed_body`` e
    ``input_schema`` son excluyentes: una acción tiene cuerpo fijo, o formulario, o
    ningún cuerpo (jamás los dos).

    ``visible_when``/``enabled_when`` son condiciones de estado (DSL serializable de
    capabilities) que el frontend usa como guía; el backend revalida siempre. El permiso
    nunca se expresa en estas condiciones: es la propiedad ``permission``."""

    name: str
    label: str
    method: HttpMethod
    url_template: str
    scope: ActionScope
    danger: bool
    permission: SecurityGroup
    fixed_body: Optional[dict[str, object]] = None
    input_schema: Optional[type[BaseModel]] = None
    confirmation: Optional[ConfirmationDef] = None
    visible_when: Optional[ActionCondition] = None
    enabled_when: Optional[ActionCondition] = None

    def __post_init__(self) -> None:
        # Falla temprano (al definir el recurso), no al proyectar la capability.
        if self.fixed_body is not None and self.input_schema is not None:
            raise ValueError(
                f"La acción '{self.name}' no puede declarar 'fixed_body' e 'input_schema' a la vez."
            )
        if self.input_schema is not None:
            extra = self.input_schema.model_config.get("extra")
            if extra != "forbid":
                raise ValueError(
                    f"El input_schema de la acción '{self.name}' debe usar extra='forbid'."
                )


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
class RelatedListDef:
    """Lista relacionada navegable por item (p. ej. las corridas de un proceso).

    ``resource`` es el nombre REGISTRADO del recurso destino y ``filter_field`` su
    campo de filtro EQ (debe estar en los ``filter_fields`` del destino) que recibe
    el id del item dueño. La proyección la publica solo si el actor tiene el permiso
    de lectura del recurso destino; es navegación de solo lectura, no un editor."""

    resource: str
    label: str
    filter_field: str


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
    # Transporte del formulario de creación. ``MULTIPART`` declara una carga de archivo:
    # ``create_file_field`` describe el campo de archivo (genérico). Los campos de
    # metadata siguen proyectándose desde ``create_schema``.
    create_transport: FormTransport = FormTransport.JSON
    create_file_field: Optional[ResourceFileFieldCapability] = None
    # Descarga de binario por item. Si se declara, el recurso publica ``file_download``
    # cuando el actor tiene ``download_permission`` (distinto del de lectura).
    download_url_template: Optional[str] = None
    download_permission: Optional[SecurityGroup] = None
    # Lectura individual: si está declarada, el recurso publica ``item_reference`` y
    # ``detail``. El campo identificador (el id del item (invariante ``id``)) coincide con el token
    # ``{id}`` de las plantillas de URL (detail, update, acciones).
    detail_url_template: Optional[str] = None
    actions: tuple[ActionDef, ...] = ()
    relations: tuple[RelationDef, ...] = ()
    related_lists: tuple[RelatedListDef, ...] = ()


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
                # POST sin parámetros: cuerpo vacío explícito ({}) para que el cliente
                # capability-driven envíe un JSON válido y nunca reciba 422.
                fixed_body={},
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
        name="system_settings",
        label="Configuración del sistema",
        api_path="/api/v1/system-settings",
        view=ResourceView.TABLE,
        read_permission=SystemSettingsPermissions.READ,
        list_query=SYSTEM_SETTINGS,
        list_schema=SystemSettingsListItem,
        # Singleton editable: sin create ni delete; el update usa el PATCH del detail.
        update_schema=SystemSettingsUpdate,
        update_permission=SystemSettingsPermissions.CONFIGURE,
        detail_url_template="/api/v1/system-settings/{id}",
        actions=(
            ActionDef(
                name="verify_domain",
                label="Verificar dominio",
                method=HttpMethod.POST,
                url_template="/api/v1/system-settings/{id}/verify-domain",
                scope=ActionScope.ITEM,
                danger=False,
                permission=SystemSettingsPermissions.CONFIGURE,
                input_schema=VerifyDomainRequest,
                confirmation=ConfirmationDef(
                    title="Verificar dominio",
                    message=(
                        "Se comprobará que el dominio sirve esta instalación y se "
                        "usará para calcular las URLs de OAuth."
                    ),
                    confirm_label="Verificar",
                    destructive=False,
                    required=False,
                ),
            ),
            ActionDef(
                name="send_test_email",
                label="Enviar correo de prueba",
                method=HttpMethod.POST,
                url_template="/api/v1/system-settings/{id}/send-test-email",
                scope=ActionScope.ITEM,
                danger=False,
                permission=SystemSettingsPermissions.CONFIGURE,
                input_schema=SendTestEmailRequest,
                confirmation=ConfirmationDef(
                    title="Correo de prueba",
                    message="Se enviará un correo real con el transporte configurado.",
                    confirm_label="Enviar",
                    destructive=False,
                    required=False,
                ),
            ),
        ),
    ),
    ResourceDefinition(
        name="backup_settings",
        label="Configuración de respaldos",
        api_path="/api/v1/backup-settings",
        view=ResourceView.TABLE,
        read_permission=BackupPermissions.READ,
        list_query=BACKUP_SETTINGS,
        list_schema=BackupSettingsListItem,
        # Singleton editable: sin create ni delete; el update usa el PATCH del detail.
        update_schema=BackupSettingsUpdate,
        update_permission=BackupPermissions.CONFIGURE,
        detail_url_template="/api/v1/backup-settings/{id}",
        actions=(
            ActionDef(
                name="connect_drive",
                fixed_body={},
                label="Conectar Google Drive",
                method=HttpMethod.POST,
                url_template="/api/v1/backup-settings/{id}/connect-drive",
                scope=ActionScope.ITEM,
                danger=False,
                permission=BackupPermissions.CONFIGURE,
            ),
            ActionDef(
                name="disconnect_drive",
                fixed_body={},
                label="Desconectar Google Drive",
                method=HttpMethod.POST,
                url_template="/api/v1/backup-settings/{id}/disconnect-drive",
                scope=ActionScope.ITEM,
                danger=True,
                permission=BackupPermissions.CONFIGURE,
                confirmation=ConfirmationDef(
                    title="Desconectar Google Drive",
                    message=(
                        "Se olvidará la conexión y los respaldos quedarán deshabilitados. "
                        "Los archivos ya subidos y el historial se conservan."
                    ),
                    confirm_label="Desconectar",
                    destructive=True,
                ),
            ),
            ActionDef(
                name="generate_encryption_key",
                fixed_body={},
                label="Generar clave de cifrado",
                method=HttpMethod.POST,
                url_template="/api/v1/backup-settings/{id}/generate-encryption-key",
                scope=ActionScope.ITEM,
                danger=False,
                permission=BackupPermissions.CONFIGURE,
                confirmation=ConfirmationDef(
                    title="Generar clave de cifrado",
                    message=(
                        "Se generará una clave de cifrado para los respaldos y la clave "
                        "PRIVADA se enviará a tu correo — guárdala: es la única forma de "
                        "abrir los respaldos cifrados. Reemplaza cualquier clave anterior."
                    ),
                    confirm_label="Generar y enviar por correo",
                    destructive=False,
                ),
            ),
            ActionDef(
                name="run_now",
                fixed_body={},
                label="Respaldar ahora",
                method=HttpMethod.POST,
                url_template="/api/v1/backup-settings/{id}/run-now",
                scope=ActionScope.ITEM,
                danger=False,
                permission=BackupPermissions.CONFIGURE,
                confirmation=ConfirmationDef(
                    title="Respaldo manual",
                    message="Se encolará un respaldo hacia Google Drive.",
                    confirm_label="Respaldar",
                    destructive=False,
                ),
            ),
        ),
    ),
    ResourceDefinition(
        name="backup_runs",
        label="Historial de respaldos",
        api_path="/api/v1/backup-runs",
        view=ResourceView.TABLE,
        # SÓLO LECTURA: el historial lo escribe el worker; sin create/update/delete.
        read_permission=BackupPermissions.READ,
        list_query=BACKUP_RUNS,
        list_schema=BackupRunListItem,
        detail_url_template="/api/v1/backup-runs/{id}",
    ),
    ResourceDefinition(
        name="audit_events",
        label="Registros de auditoría",
        api_path="/api/v1/audit-events",
        view=ResourceView.TABLE,
        # Recurso SÓLO LECTURA: no declara create_schema/update_schema ni acciones (la
        # bitácora es append-only). El gate es el permiso dedicado de auditoría
        # (audit_events:read).
        read_permission=AuditEventPermissions.READ,
        list_query=AUDIT_EVENTS,
        list_schema=AuditEventListItem,
        detail_url_template="/api/v1/audit-events/{id}",
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
