from dataclasses import dataclass, field
from uuid import UUID

from pydantic import SecretStr
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from backend.app.auth.security import generate_token, get_password_hash
from backend.app.models.setup import PlatformSetup
from backend.app.models.user import Role, RoleAccess, User, UserRole
from backend.app.security.catalog import declared_permissions
from backend.app.utils.utc_now import utc_now

SETUP_ID = 1
SETUP_PENDING = "pending"
SETUP_COMPLETED = "completed"
ORIGIN_BOOTSTRAP = "bootstrap"
ORIGIN_LEGACY = "legacy"
MAX_ADDITIONAL_ROLES = 10


class BootstrapError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class PlatformSetupStatus:
    setup_required: bool
    token_required: bool


@dataclass(frozen=True)
class BootstrapUserInput:
    name: str
    last_name: str
    email: str
    password: SecretStr


@dataclass(frozen=True)
class BootstrapRoleInput:
    label: str = "Administrador de plataforma"
    description: str | None = "Administracion inicial de la plataforma"


@dataclass(frozen=True)
class BootstrapAdditionalRoleInput:
    name: str
    description: str | None = None
    permissions: list[str] = field(default_factory=list)
    assign_to_initial_user: bool = False


@dataclass(frozen=True)
class BootstrapInitializeInput:
    user: BootstrapUserInput
    system_admin_role: BootstrapRoleInput = field(default_factory=BootstrapRoleInput)
    additional_roles: list[BootstrapAdditionalRoleInput] = field(default_factory=list)
    # Política inicial de plataforma (sin secretos de terceros).
    # Dominio público (origen) de la instalación: se persiste en system_settings y
    # habilita las mutaciones autenticadas por cookie desde ese origen (guard CSRF).
    app_base_url: str | None = None
    public_registration_enabled: bool = False
    password_reset_enabled: bool = True
    institution_name: str | None = None
    # Duración de sesión (None = default del despliegue).
    customer_session_days: int | None = None
    staff_session_minutes: int | None = None


@dataclass(frozen=True)
class BootstrapInitializeResult:
    user: User
    system_admin_role: Role
    additional_roles: list[Role]


def get_platform_setup_status(session: Session, *, token_required: bool) -> PlatformSetupStatus:
    setup = ensure_platform_setup(session)
    return PlatformSetupStatus(
        setup_required=setup.status == SETUP_PENDING and not _users_exist(session),
        token_required=token_required,
    )


def ensure_platform_setup(session: Session) -> PlatformSetup:
    setup = session.get(PlatformSetup, SETUP_ID)
    if setup is not None:
        return setup

    setup = PlatformSetup(id=SETUP_ID)
    if _users_exist(session):
        _mark_completed(setup, origin=ORIGIN_LEGACY)
    session.add(setup)
    session.flush()
    return setup


def initialize_platform(session: Session, payload: BootstrapInitializeInput) -> BootstrapInitializeResult:
    setup = _locked_platform_setup(session)
    if setup.status != SETUP_PENDING or _users_exist(session):
        raise BootstrapError("bootstrap_unavailable", "Bootstrap no disponible.")

    permissions = declared_permissions()
    _validate_payload(payload, permissions)

    system_admin_role = Role(
        name=_clean_required(payload.system_admin_role.label, "system_admin_role.label"),
        description=_clean_optional(payload.system_admin_role.description),
        is_active=True,
    )
    session.add(system_admin_role)
    session.flush()

    for permission in sorted(permissions):
        session.add(RoleAccess(role_id=system_admin_role.id, access=permission, is_active=True))

    additional_roles: list[Role] = []
    for role_input in payload.additional_roles:
        role = Role(
            name=_clean_required(role_input.name, "additional_roles.name"),
            description=_clean_optional(role_input.description),
            is_active=True,
        )
        session.add(role)
        additional_roles.append(role)

    session.flush()

    for role, role_input in zip(additional_roles, payload.additional_roles):
        for permission in sorted(set(role_input.permissions)):
            session.add(RoleAccess(role_id=role.id, access=permission, is_active=True))

    user = User(
        name=_clean_required(payload.user.name, "user.name"),
        last_name=_clean_required(payload.user.last_name, "user.last_name"),
        email=_clean_required(payload.user.email, "user.email"),
        is_active=True,
        hashed_password=get_password_hash(payload.user.password),
        token=generate_token(),
    )
    session.add(user)
    session.flush()

    session.add(UserRole(user_id=user.id, role_id=system_admin_role.id))
    for role, role_input in zip(additional_roles, payload.additional_roles):
        if role_input.assign_to_initial_user:
            session.add(UserRole(user_id=user.id, role_id=role.id))

    _mark_completed(
        setup,
        origin=ORIGIN_BOOTSTRAP,
        completed_by_user_id=user.id,
        system_admin_role_id=system_admin_role.id,
    )
    session.flush()

    # Decisiones de POLÍTICA del asistente → singleton de configuración del sistema
    # (la migración ya sembró la fila; aquí sólo se actualiza).
    from backend.app.services.system_settings_service import apply_bootstrap_choices

    apply_bootstrap_choices(
        session,
        public_registration_enabled=payload.public_registration_enabled,
        institution_name=payload.institution_name,
        password_reset_enabled=payload.password_reset_enabled,
        customer_session_days=payload.customer_session_days,
        staff_session_minutes=payload.staff_session_minutes,
        app_base_url=payload.app_base_url,
    )
    session.flush()

    return BootstrapInitializeResult(
        user=user,
        system_admin_role=system_admin_role,
        additional_roles=additional_roles,
    )


def sync_system_admin_role_permissions(session: Session) -> int:
    """Reconcilia el rol admin del SISTEMA con el catálogo de permisos declarados.

    El wizard de setup concede al rol admin todos los permisos declarados EN ESE MOMENTO; los
    declarados después (recursos o acciones nuevos) no llegan solos a una instalación ya
    inicializada y la función queda muda para el admin. La reconciliación es ADITIVA:
    inserta sólo los permisos sin fila para el rol; no retira permisos ni reactiva filas
    desactivadas por un administrador. Devuelve cuántos agregó.
    """
    setup = ensure_platform_setup(session)
    if setup.system_admin_role_id is None:
        return 0
    role = session.get(Role, setup.system_admin_role_id)
    if role is None or not role.is_active:
        return 0
    existing = set(
        session.exec(select(RoleAccess.access).where(RoleAccess.role_id == role.id)).all()
    )
    missing = sorted(declared_permissions() - existing)
    for permission in missing:
        session.add(RoleAccess(role_id=role.id, access=permission, is_active=True))
    session.flush()
    return len(missing)


def mark_platform_setup_completed_from_seed(
    session: Session,
    *,
    system_admin_role_id: UUID | None = None,
    completed_by_user_id: UUID | None = None,
) -> PlatformSetup:
    setup = ensure_platform_setup(session)
    if setup.status == SETUP_COMPLETED:
        if setup.completion_origin == ORIGIN_LEGACY:
            if setup.system_admin_role_id is None:
                setup.system_admin_role_id = system_admin_role_id
            if setup.completed_by_user_id is None:
                setup.completed_by_user_id = completed_by_user_id
            setup.updated_at = utc_now()
            session.flush()
        return setup
    if not _users_exist(session):
        raise BootstrapError("bootstrap_seed_without_users", "No hay usuarios para cerrar Bootstrap.")
    _mark_completed(
        setup,
        origin=ORIGIN_LEGACY,
        completed_by_user_id=completed_by_user_id,
        system_admin_role_id=system_admin_role_id,
    )
    session.flush()
    return setup


def _locked_platform_setup(session: Session) -> PlatformSetup:
    setup = session.exec(
        select(PlatformSetup).where(PlatformSetup.id == SETUP_ID).with_for_update()
    ).first()
    if setup is not None:
        return setup
    return ensure_platform_setup(session)


def _users_exist(session: Session) -> bool:
    return bool(session.exec(select(func.count(User.id))).one())


def _validate_payload(payload: BootstrapInitializeInput, permissions: set[str]) -> None:
    if len(payload.additional_roles) > MAX_ADDITIONAL_ROLES:
        raise BootstrapError("too_many_roles", "Demasiados roles iniciales.")

    if payload.app_base_url is not None and payload.app_base_url.strip():
        from backend.app.core.runtime_origins import normalize_base_url

        if normalize_base_url(payload.app_base_url) is None:
            raise BootstrapError(
                "invalid_field",
                "app_base_url debe ser un origen http(s) sin ruta ni credenciales.",
            )

    names = {_normalize_name(payload.system_admin_role.label)}
    if "" in names:
        raise BootstrapError("invalid_role_name", "El rol administrador requiere nombre.")

    for role in payload.additional_roles:
        normalized_name = _normalize_name(role.name)
        if not normalized_name:
            raise BootstrapError("invalid_role_name", "Los roles iniciales requieren nombre.")
        if normalized_name in names:
            raise BootstrapError("duplicate_role", "Los roles iniciales deben tener nombres unicos.")
        names.add(normalized_name)

        invalid = sorted(set(role.permissions) - permissions)
        if invalid:
            raise BootstrapError("invalid_permission", "El rol contiene permisos no declarados.")


def _mark_completed(
    setup: PlatformSetup,
    *,
    origin: str,
    completed_by_user_id: UUID | None = None,
    system_admin_role_id: UUID | None = None,
) -> None:
    now = utc_now()
    setup.status = SETUP_COMPLETED
    setup.completed_at = now
    setup.completed_by_user_id = completed_by_user_id
    setup.system_admin_role_id = system_admin_role_id
    setup.completion_origin = origin
    setup.updated_at = now


def _clean_required(value: str, field_name: str) -> str:
    cleaned = " ".join(value.strip().split())
    if not cleaned:
        raise BootstrapError("invalid_field", f"{field_name} es obligatorio.")
    return cleaned


def _clean_optional(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(value.strip().split())
    return cleaned or None


def _normalize_name(value: str) -> str:
    return " ".join(value.strip().casefold().split())
