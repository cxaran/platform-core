from enum import Enum
from typing import Any, ClassVar

from .security_control import SecurityControl

class SecurityGroup(Enum):
    """Enum base: cada miembro almacena su propio AccessControl.

    Cada subclase declara su etiqueta legible al crearse::

        class PatientPermissions(SecurityGroup, label="Pacientes"): ...

    El nombre del grupo no se declara: se deriva del prefijo de acceso de sus
    permisos (``patients:read`` → ``patients``).
    """

    _group_label: ClassVar[str]

    def __init_subclass__(cls, *, label: str, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)
        cls._group_label = label

    # ----- Metadatos del grupo (a nivel de clase) -----
    @classmethod
    def group_name(cls) -> str:
        """Nombre del grupo, derivado del prefijo de acceso de sus permisos."""
        return next(iter(cls)).permission.split(":", 1)[0]

    @classmethod
    def group_label(cls) -> str:
        """Etiqueta legible del grupo, declarada al crear la subclase."""
        return cls._group_label

    def __init__(self, access: str, description: str):
        self._control = SecurityControl(access, description)

    # ----- Permiso específico (miembro del Enum) -----
    @property
    def permission(self) -> str:
        return self._control.access

    @property
    def description(self) -> str | None:
        return self._control.description

    @property
    def check(self):
        return self._control.check

    @property
    def requiere(self) -> Any:
        return self._control.requiere
