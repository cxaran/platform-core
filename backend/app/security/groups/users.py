from backend.app.security.security_group import SecurityGroup


class UserPermissions(SecurityGroup, label="Usuarios"):
    READ = ("users:read", "Listar usuarios")
    CREATE = ("users:create", "Crear usuarios")
    UPDATE = ("users:update", "Actualizar usuarios")
    DELETE = ("users:delete", "Eliminar usuarios")
    MANAGE_ROLES = ("users:manage_roles", "Asignar roles a usuarios")
    REVOKE_SESSIONS = ("users:revoke_sessions", "Revocar sesiones de usuarios")
