from sqlmodel import Session, select

from backend.app.auth.security import generate_token, get_password_hash
from backend.app.core.database import engine
from backend.app.core.settings import settings
from backend.app.bootstrap.service import mark_platform_setup_completed_from_seed
from backend.app.models.user import Role, RoleAccess, User, UserRole
from backend.app.security.catalog import declared_permissions


def _get_or_create_role(session: Session, *, name: str, description: str) -> Role:
    role = session.exec(select(Role).where(Role.name == name)).first()
    if role is None:
        role = Role(name=name, description=description, is_active=True)
        session.add(role)
        session.flush()
        return role

    role.description = description
    role.is_active = True
    return role


def _sync_role_permissions(session: Session, role: Role, permissions: set[str]) -> None:
    current = {
        item.access: item
        for item in session.exec(select(RoleAccess).where(RoleAccess.role_id == role.id)).all()
    }

    for permission in sorted(permissions):
        item = current.get(permission)
        if item is None:
            session.add(RoleAccess(role_id=role.id, access=permission, is_active=True))
        else:
            item.is_active = True

    for permission, item in current.items():
        if permission not in permissions:
            item.is_active = False


def _get_or_create_admin_user(session: Session) -> User:
    if settings.bootstrap_admin_email is None or settings.bootstrap_admin_password is None:
        raise RuntimeError(
            "Defina BOOTSTRAP_ADMIN_EMAIL y BOOTSTRAP_ADMIN_PASSWORD para crear el usuario inicial."
        )

    user = session.exec(select(User).where(User.email == settings.bootstrap_admin_email)).first()
    if user is not None:
        user.is_active = True
        return user

    user = User(
        name=settings.bootstrap_admin_name,
        last_name=settings.bootstrap_admin_last_name,
        email=settings.bootstrap_admin_email,
        is_active=True,
        hashed_password=get_password_hash(settings.bootstrap_admin_password),
        token=generate_token(),
    )
    session.add(user)
    session.flush()
    return user


def _ensure_user_role(session: Session, *, user: User, role: Role) -> None:
    exists = session.exec(
        select(UserRole).where(UserRole.user_id == user.id, UserRole.role_id == role.id)
    ).first()
    if exists is None:
        session.add(UserRole(user_id=user.id, role_id=role.id))


def bootstrap_initial_data() -> None:
    """Crea datos mínimos idempotentes para operar la base del proyecto."""
    permissions = declared_permissions()

    with Session(engine) as session:
        admin_role = _get_or_create_role(
            session,
            name=settings.bootstrap_admin_role_name,
            description="Rol administrador con todos los permisos declarados.",
        )
        _get_or_create_role(
            session,
            name=settings.bootstrap_user_role_name,
            description="Rol base para usuarios autenticados sin permisos administrativos.",
        )
        _sync_role_permissions(session, admin_role, permissions)

        admin_user = _get_or_create_admin_user(session)
        _ensure_user_role(session, user=admin_user, role=admin_role)
        mark_platform_setup_completed_from_seed(
            session,
            system_admin_role_id=admin_role.id,
            completed_by_user_id=admin_user.id,
        )

        session.commit()


def main() -> None:
    bootstrap_initial_data()
    print("Bootstrap inicial completado correctamente.")


if __name__ == "__main__":
    main()
