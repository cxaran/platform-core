from backend.app.security.groups.audit_events import AuditEventPermissions
from backend.app.security.groups.backups import BackupPermissions
from backend.app.security.groups.permissions import PermissionPermissions
from backend.app.security.groups.roles import RolePermissions
from backend.app.security.groups.system_settings import SystemSettingsPermissions
from backend.app.security.groups.users import UserPermissions
from backend.app.security.security_group import SecurityGroup


SECURITY_GROUPS: list[type[SecurityGroup]] = [
    UserPermissions,
    RolePermissions,
    PermissionPermissions,
    SystemSettingsPermissions,
    BackupPermissions,
    AuditEventPermissions,
]


def declared_permissions() -> set[str]:
    """Conjunto de todos los permisos declarados en código.

    Fuente única para validar que un permiso solicitado exista; evita recomputar
    la derivación del catálogo en cada router.
    """
    return {permission.permission for group in SECURITY_GROUPS for permission in group}
