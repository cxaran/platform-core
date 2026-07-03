from backend.app.security.security_group import SecurityGroup


class BackupPermissions(SecurityGroup, label="Respaldos"):
    # Respaldos cifrados hacia Google Drive. Dos permisos gruesos (sin un permiso por
    # acción todavía): leer configuración/historial y configurar. CONFIGURE cubre
    # editar la configuración, conectar/reconectar/desconectar Drive y ejecutar un
    # respaldo manual. Operativo, no clínico: nunca expone datos de pacientes.
    READ = ("backups:read", "Ver configuración e historial de respaldos")
    CONFIGURE = ("backups:configure", "Configurar respaldos y conexión con Google Drive")
