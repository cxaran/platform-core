"""Supervivencia administrativa: el core es la autoridad que impide dejar la
instalación sin cobertura administrativa efectiva.

La validación se evalúa como **post-condición** de una mutación sensible, dentro
de la **misma transacción** que la aplica: el llamador aplica el cambio, hace
``flush`` y luego invoca :func:`assert_admin_survival`; si la invariante se rompe,
se lanza :class:`AdminCoverageError` y el llamador revierte.

Cobertura efectiva de un usuario::

    usuario activo
    → roles activos asignados (UserRole → Role.is_active)
    → RoleAccess activos (is_active)
    → intersección con declared_permissions()

Invariantes garantizadas tras toda mutación sensible:

1. Debe existir al menos un usuario activo cuya cobertura efectiva contenga
   **todos** los permisos declarados actuales.
2. Si ``platform_setup.system_admin_role_id`` está fijado, ese rol debe seguir
   existiendo, estar activo y conservar cobertura completa del catálogo.

El error público es estable y opaco: nunca revela qué usuario, rol o permiso fue
el último elemento crítico.
"""

from uuid import UUID

from sqlmodel import Session, select

from backend.app.models.setup import PlatformSetup
from backend.app.models.user import Role, RoleAccess, User, UserRole
from backend.app.security.catalog import declared_permissions

# El estado de instalación es un singleton con id fijo (ver models/setup.py). Se
# declara local para no acoplar la capa de seguridad al paquete bootstrap.
PLATFORM_SETUP_ID = 1

ADMIN_COVERAGE_REQUIRED = "admin_coverage_required"


class AdminCoverageError(Exception):
    """La operación dejaría la instalación sin cobertura administrativa efectiva.

    Error estable y opaco: el mensaje no revela el elemento crítico concreto.
    """

    code = ADMIN_COVERAGE_REQUIRED

    def __init__(
        self,
        message: str = "La operación dejaría la plataforma sin cobertura administrativa.",
    ) -> None:
        super().__init__(message)
        self.message = message


def effective_coverage(session: Session, user_id: UUID) -> set[str]:
    """Permisos efectivos de un usuario activo a través de roles y accesos activos."""
    stmt = (
        select(RoleAccess.access)
        .join(UserRole, UserRole.role_id == RoleAccess.role_id)
        .join(Role, Role.id == UserRole.role_id)
        .join(User, User.id == UserRole.user_id)
        .where(
            User.id == user_id,
            User.is_active.is_(True),
            Role.is_active.is_(True),
            RoleAccess.is_active.is_(True),
        )
    )
    return set(session.exec(stmt).all())


def user_has_full_admin_coverage(session: Session, user_id: UUID) -> bool:
    """¿Este usuario activo cubre TODOS los permisos declarados?

    Es el criterio de "administrador con supervivencia": estos usuarios quedan
    exentos de la verificación de login por correo (garantía anti-bloqueo)."""
    from backend.app.security.catalog import declared_permissions

    return declared_permissions() <= effective_coverage(session, user_id)


def _coverage_by_user(session: Session) -> dict[UUID, set[str]]:
    """Mapa ``user_id → permisos efectivos`` de todos los usuarios activos.

    Una sola consulta de pares ``(user_id, access)`` agrupada en memoria; el alcance
    de una plataforma administrativa hace innecesaria una agregación en SQL.
    """
    stmt = (
        select(UserRole.user_id, RoleAccess.access)
        .join(User, User.id == UserRole.user_id)
        .join(Role, Role.id == UserRole.role_id)
        .join(RoleAccess, RoleAccess.role_id == Role.id)
        .where(
            User.is_active.is_(True),
            Role.is_active.is_(True),
            RoleAccess.is_active.is_(True),
        )
    )
    coverage: dict[UUID, set[str]] = {}
    for user_id, access in session.exec(stmt).all():
        coverage.setdefault(user_id, set()).add(access)
    return coverage


def has_full_admin_coverage(session: Session, required: set[str]) -> bool:
    """¿Existe al menos un usuario activo cuya cobertura cubra todo ``required``?"""
    return any(required <= coverage for coverage in _coverage_by_user(session).values())


def _system_admin_role_intact(session: Session, required: set[str]) -> bool:
    """El rol administrador fundacional, si está fijado, conserva cobertura total."""
    setup = session.get(PlatformSetup, PLATFORM_SETUP_ID)
    if setup is None or setup.system_admin_role_id is None:
        return True
    role = session.get(Role, setup.system_admin_role_id)
    if role is None or not role.is_active:
        return False
    access = set(
        session.exec(
            select(RoleAccess.access).where(
                RoleAccess.role_id == role.id,
                RoleAccess.is_active.is_(True),
            )
        ).all()
    )
    return required <= access


def assert_admin_survival(session: Session) -> None:
    """Verifica las invariantes de supervivencia sobre el estado ya aplicado.

    Debe invocarse tras el ``flush`` de la mutación y antes del ``commit``. Lanza
    :class:`AdminCoverageError` si alguna invariante se rompe.
    """
    required = declared_permissions()
    if not _system_admin_role_intact(session, required):
        raise AdminCoverageError()
    if not has_full_admin_coverage(session, required):
        raise AdminCoverageError()
