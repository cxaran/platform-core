from backend.app.security.security_group import SecurityGroup


class NotificationPermissions(SecurityGroup, label="Notificaciones"):
    # Las notificaciones PROPIAS (campana) las lee cualquier usuario
    # autenticado — recurso /me sin permiso. SEND habilita el panel de difusión
    # del administrador (broadcast a clientes/personal). Los avisos dirigidos a
    # quienes tienen cierto permiso se emiten con
    # ``notify_users_with_permission`` usando el permiso que cada proyecto elija.
    SEND = ("notifications:send", "Enviar notificaciones y promociones")
