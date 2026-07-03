from backend.app.security.security_group import SecurityGroup


class RolePermissions(SecurityGroup, label="Roles"):
    READ = ("roles:read", "Listar roles")
    CREATE = ("roles:create", "Crear roles")
    UPDATE = ("roles:update", "Actualizar roles")
    DELETE = ("roles:delete", "Eliminar roles")
    MANAGE_PERMISSIONS = ("roles:manage_permissions", "Asignar permisos a roles")
