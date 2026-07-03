import os
import unittest

from pydantic import SecretStr
from sqlalchemy import create_engine
from sqlmodel import Session, select


DEV_ENV = {
    "ENVIRONMENT": "local",
    "SECRET_KEY": "test-secret-key",
    "ACCESS_TOKEN_EXPIRE_MINUTES": "30",
    "EMAIL_TOKEN_EXPIRE_MINUTES": "30",
    "TRYS_BEFORE_LOCK": "5",
    "REDIS_HOST": "redis",
    "REDIS_PORT": "6379",
    "REDIS_DB": "0",
    "SMTP_HOST": "mailpit",
    "SMTP_PORT": "1025",
    "SMTP_USER": "test@example.com",
    "SMTP_PASSWORD": "test-password",
    "SMTP_FROM_EMAIL": "test@example.com",
    "SMTP_FROM_NAME": "Platform Core Test",
    "SMTP_TLS": "false",
    "SMTP_SSL": "false",
    "SMTP_USE_CREDENTIALS": "false",
    "POSTGRES_USER": "platform",
    "POSTGRES_PASSWORD": "platform",
    "POSTGRES_SERVER": "postgres",
    "POSTGRES_PORT": "5432",
    "POSTGRES_DB": "platform_core",
}

os.environ.update(DEV_ENV)

from backend.app.auth.security import verify_password  # noqa: E402
from backend.app.bootstrap.service import (  # noqa: E402
    sync_system_admin_role_permissions,
    BootstrapAdditionalRoleInput,
    BootstrapError,
    BootstrapInitializeInput,
    BootstrapRoleInput,
    BootstrapUserInput,
    get_platform_setup_status,
    initialize_platform,
)
from backend.app.models import Base  # noqa: E402
from backend.app.models.setup import PlatformSetup  # noqa: E402
from backend.app.models.user import Role, RoleAccess, User, UserRole  # noqa: E402
from backend.app.security.catalog import declared_permissions  # noqa: E402


class PlatformSetupServiceTest(unittest.TestCase):
    def _engine(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        return engine

    def _payload(self) -> BootstrapInitializeInput:
        return BootstrapInitializeInput(
            user=BootstrapUserInput(
                name="Admin",
                last_name="Platform",
                email="admin@example.com",
                password=SecretStr("admin-password-123"),
            ),
            system_admin_role=BootstrapRoleInput(
                label="Administrador de plataforma",
                description="Administracion inicial de la plataforma",
            ),
            additional_roles=[
                BootstrapAdditionalRoleInput(
                    name="Operacion",
                    description="Rol operativo inicial",
                    permissions=["users:read", "users:read"],
                    assign_to_initial_user=True,
                )
            ],
        )

    def test_clean_install_requires_setup(self) -> None:
        engine = self._engine()
        with Session(engine) as session:
            status = get_platform_setup_status(session, token_required=False)

            self.assertTrue(status.setup_required)
            self.assertFalse(status.token_required)

    def test_initialize_creates_admin_role_user_roles_and_completes_setup(self) -> None:
        engine = self._engine()
        permissions = declared_permissions()
        with Session(engine) as session:
            result = initialize_platform(session, self._payload())
            session.commit()

            setup = session.get(PlatformSetup, 1)
            users = session.exec(select(User)).all()
            roles = session.exec(select(Role)).all()
            user_roles = session.exec(select(UserRole)).all()
            system_accesses = session.exec(
                select(RoleAccess.access).where(RoleAccess.role_id == result.system_admin_role.id)
            ).all()
            extra_role = next(role for role in roles if role.id != result.system_admin_role.id)
            extra_accesses = session.exec(
                select(RoleAccess.access).where(RoleAccess.role_id == extra_role.id)
            ).all()

        self.assertIsNotNone(setup)
        self.assertEqual(setup.status, "completed")
        self.assertEqual(setup.completion_origin, "bootstrap")
        self.assertEqual(setup.completed_by_user_id, users[0].id)
        self.assertEqual(setup.system_admin_role_id, result.system_admin_role.id)
        self.assertEqual(len(users), 1)
        self.assertTrue(users[0].is_active)
        self.assertTrue(verify_password(SecretStr("admin-password-123"), users[0].hashed_password))
        self.assertEqual(len(roles), 2)
        self.assertEqual(set(system_accesses), permissions)
        self.assertEqual(extra_accesses, ["users:read"])
        self.assertEqual(len(user_roles), 2)

    def test_invalid_permission_rolls_back_without_partial_data(self) -> None:
        engine = self._engine()
        payload = BootstrapInitializeInput(
            user=self._payload().user,
            additional_roles=[
                BootstrapAdditionalRoleInput(name="Operacion", permissions=["unknown:permission"])
            ],
        )
        with Session(engine) as session:
            with self.assertRaises(BootstrapError):
                initialize_platform(session, payload)
            session.rollback()

            self.assertEqual(session.exec(select(User)).all(), [])
            self.assertEqual(session.exec(select(Role)).all(), [])
            self.assertEqual(session.exec(select(RoleAccess)).all(), [])
            self.assertEqual(session.exec(select(UserRole)).all(), [])

    def test_duplicate_role_names_are_rejected_after_normalization(self) -> None:
        engine = self._engine()
        payload = BootstrapInitializeInput(
            user=self._payload().user,
            system_admin_role=BootstrapRoleInput(label="Administradores"),
            additional_roles=[BootstrapAdditionalRoleInput(name=" administradores ")],
        )
        with Session(engine) as session:
            with self.assertRaises(BootstrapError) as caught:
                initialize_platform(session, payload)

        self.assertEqual(caught.exception.code, "duplicate_role")

    def test_pending_state_with_existing_users_fails_safe(self) -> None:
        engine = self._engine()
        with Session(engine) as session:
            session.add(PlatformSetup(id=1, status="pending"))
            session.add(
                User(
                    name="Existing",
                    last_name="Admin",
                    email="existing@example.com",
                    is_active=True,
                    hashed_password="hash",
                    token="token",
                )
            )
            session.commit()

            status = get_platform_setup_status(session, token_required=True)
            self.assertFalse(status.setup_required)
            self.assertTrue(status.token_required)
            with self.assertRaises(BootstrapError) as caught:
                initialize_platform(session, self._payload())

        self.assertEqual(caught.exception.code, "bootstrap_unavailable")

    def test_initialize_applies_initial_policy_to_system_settings(self) -> None:
        from dataclasses import replace

        from backend.app.models.system_settings import SystemSettings

        engine = self._engine()
        with Session(engine) as session:
            payload = replace(
                self._payload(),
                public_registration_enabled=True,
                password_reset_enabled=False,
                institution_name="  Empresa Norte  ",
            )
            initialize_platform(session, payload)
            session.commit()

            row = session.exec(select(SystemSettings)).one()
            self.assertTrue(row.public_registration_enabled)
            self.assertFalse(row.password_reset_enabled)
            self.assertEqual(row.institution_name, "Empresa Norte")

    def test_sync_system_admin_role_adds_permissions_declared_after_setup(self) -> None:
        engine = self._engine()
        with Session(engine) as session:
            result = initialize_platform(session, self._payload())
            session.commit()

            # Simula un permiso declarado DESPUÉS del setup (fila ausente: se repone) y
            # uno desactivado por un administrador (se respeta, no se reactiva).
            removed = session.exec(
                select(RoleAccess).where(
                    RoleAccess.role_id == result.system_admin_role.id,
                    RoleAccess.access == "audit_events:read",
                )
            ).one()
            session.delete(removed)
            disabled = session.exec(
                select(RoleAccess).where(
                    RoleAccess.role_id == result.system_admin_role.id,
                    RoleAccess.access == "permissions:read",
                )
            ).one()
            disabled.is_active = False
            session.commit()

            added = sync_system_admin_role_permissions(session)
            session.commit()

            accesses = {
                access.access: access.is_active
                for access in session.exec(
                    select(RoleAccess).where(
                        RoleAccess.role_id == result.system_admin_role.id
                    )
                ).all()
            }

        self.assertEqual(added, 1)
        self.assertTrue(accesses["audit_events:read"])  # repuesto
        self.assertFalse(accesses["permissions:read"])  # respetado (no se reactiva)
        self.assertEqual(set(accesses), declared_permissions())

    def test_sync_without_system_admin_role_is_noop(self) -> None:
        engine = self._engine()
        with Session(engine) as session:
            self.assertEqual(sync_system_admin_role_permissions(session), 0)


if __name__ == "__main__":
    unittest.main()
