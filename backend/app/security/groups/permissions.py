from backend.app.security.security_group import SecurityGroup


class PermissionPermissions(SecurityGroup, label="Permisos"):
    READ = ("permissions:read", "Listar permisos disponibles")
