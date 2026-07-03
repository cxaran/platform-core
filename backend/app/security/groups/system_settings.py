from backend.app.security.security_group import SecurityGroup


class SystemSettingsPermissions(SecurityGroup, label="Configuración del sistema"):
    # Política de plataforma editable en runtime (singleton system_settings):
    # registro público, dominio base, datos institucionales y —en fases siguientes—
    # correo y proveedores de IA. Dos permisos gruesos siguiendo el patrón de
    # respaldos: leer estado seguro (sin secretos) y configurar. Distinto de
    # institutional_settings (parámetros CLÍNICOS) y de backups.
    READ = ("system_settings:read", "Ver la configuración del sistema y el checklist de puesta en marcha")
    CONFIGURE = ("system_settings:configure", "Editar la configuración del sistema")
