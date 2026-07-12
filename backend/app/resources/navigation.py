"""Registro declarativo de módulos ESPECIALIZADOS de navegación.

Los recursos tabulares se descubren por ``RESOURCE_REGISTRY``; las pantallas
especializadas (editores propios, tableros operativos…) no tienen contrato
tabular y solo necesitan aparecer en la navegación según permisos. Este módulo
declara ese contrato mínimo: nombre, label, ``href``, sección y los permisos
que lo hacen visible (*anyOf*). La proyección (``visible_navigation_modules``)
publica únicamente los módulos donde el usuario tiene ALGUNO de los permisos;
cada pantalla y sus endpoints siguen revalidando permisos por su cuenta.

Base genérica: ``NAVIGATION_REGISTRY`` viene VACÍO. Cada proyecto añade sus
módulos declarando ``NavigationModuleDef`` con controles de su catálogo de
seguridad, p. ej.::

    NavigationModuleDef(
        name="sistema",
        label="Sistema",
        href="/admin/sistema",
        section="admin",
        permissions=(SystemSettingsPermissions.READ,),
    )
"""

from dataclasses import dataclass
from typing import Literal

from backend.app.schemas.capabilities import NavigationModule
from backend.app.schemas.user import SessionUser
from backend.app.security.security_group import SecurityGroup


@dataclass(frozen=True)
class NavigationModuleDef:
    """Módulo especializado declarado en código.

    ``permissions`` es un *anyOf* de controles existentes del catálogo de
    seguridad: basta que el usuario cumpla uno para que el módulo se proyecte."""

    name: str
    label: str
    href: str
    section: Literal["admin", "panel"]
    permissions: tuple[SecurityGroup, ...]

    def __post_init__(self) -> None:
        # Un módulo sin permisos sería visible para todos: error de definición.
        if not self.permissions:
            raise ValueError(
                f"El módulo de navegación '{self.name}' debe declarar al menos un permiso."
            )


NAVIGATION_REGISTRY: tuple[NavigationModuleDef, ...] = ()


def visible_navigation_modules(user: SessionUser) -> list[NavigationModule]:
    """Módulos donde el usuario tiene ALGUNO de los permisos declarados (anyOf)."""
    return [
        NavigationModule(
            name=module.name,
            label=module.label,
            href=module.href,
            section=module.section,
            required_permissions=[
                control.permission for control in module.permissions
            ],
        )
        for module in NAVIGATION_REGISTRY
        if any(control.check(user) for control in module.permissions)
    ]
