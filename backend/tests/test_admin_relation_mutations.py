import os
import unittest
from typing import cast

os.environ.update(
    {
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
)

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from backend.app.api.v1.roles import delete_role, replace_role_permissions  # noqa: E402
from backend.app.api.v1.users_admin import (  # noqa: E402
    delete_user,
    replace_user_roles,
)
from backend.app.models import Base  # noqa: E402
from backend.app.models.setup import PlatformSetup  # noqa: E402
from backend.app.models.user import Role, RoleAccess, User, UserRole  # noqa: E402
from backend.app.schemas.role import RolePermissionsReplace  # noqa: E402
from backend.app.schemas.user import SessionUser  # noqa: E402
from backend.app.schemas.user_admin import UserRolesReplace  # noqa: E402
from backend.app.security.admin_survival import ADMIN_COVERAGE_REQUIRED  # noqa: E402
from backend.app.security.catalog import declared_permissions  # noqa: E402


class AdminRelationMutationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.session = Session(self.engine)
        self._seed()

    def tearDown(self) -> None:
        self.session.close()

    def _add_role(self, name: str, permissions: set[str]) -> Role:
        role = Role(name=name, is_active=True)
        self.session.add(role)
        self.session.flush()
        for permission in sorted(permissions):
            self.session.add(RoleAccess(role_id=role.id, access=permission, is_active=True))
        self.session.flush()
        return role

    def _add_user(self, email: str, role: Role | None) -> User:
        user = User(
            name="User",
            last_name="Test",
            email=email,
            is_active=True,
            hashed_password="hash",
            token=f"token-{email}",
        )
        self.session.add(user)
        self.session.flush()
        if role is not None:
            self.session.add(UserRole(user_id=user.id, role_id=role.id))
        self.session.flush()
        return user

    def _seed(self) -> None:
        self.admin_role = self._add_role("Administrador", declared_permissions())
        self.editor_role = self._add_role("Editor", {"users:read"})
        self.admin = self._add_user("admin@example.com", self.admin_role)
        self.member = self._add_user("member@example.com", self.editor_role)
        self.session.add(
            PlatformSetup(id=1, status="completed", system_admin_role_id=self.admin_role.id)
        )
        self.session.commit()
        self.actor = SessionUser(
            id=self.admin.id,
            name="Admin",
            last_name="Platform",
            email="admin@example.com",
            permissions=declared_permissions(),
        )

    def _assert_blocked(self, ctx: HTTPException) -> None:
        self.assertEqual(ctx.status_code, 409)
        self.assertEqual(cast(dict, ctx.detail)["code"], ADMIN_COVERAGE_REQUIRED)

    # --- Mutaciones válidas ---

    def test_replace_member_roles_succeeds_and_invalidates_session(self) -> None:
        before = self.member.token
        replace_user_roles(
            self.member.id,
            UserRolesReplace(role_ids=[self.admin_role.id]),
            self.session,
            self.actor,
            True,
        )
        self.session.refresh(self.member)
        self.assertNotEqual(self.member.token, before)
        assigned = self.session.exec(
            select(UserRole.role_id).where(UserRole.user_id == self.member.id)
        ).all()
        self.assertEqual(set(assigned), {self.admin_role.id})

    def test_changing_role_permissions_invalidates_member_sessions(self) -> None:
        before = self.member.token
        replace_role_permissions(
            self.editor_role.id,
            RolePermissionsReplace(permissions=["roles:read"]),
            self.session,
            self.actor,
            True,
        )
        self.session.refresh(self.member)
        self.assertNotEqual(self.member.token, before)
        perms = self.session.exec(
            select(RoleAccess.access).where(RoleAccess.role_id == self.editor_role.id)
        ).all()
        self.assertEqual(set(perms), {"roles:read"})

    # --- Supervivencia administrativa: operaciones bloqueadas ---

    def test_removing_last_admin_roles_is_blocked(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            replace_user_roles(
                self.admin.id,
                UserRolesReplace(role_ids=[]),
                self.session,
                self.actor,
                True,
            )
        self._assert_blocked(ctx.exception)

    def test_stripping_system_role_permissions_is_blocked(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            replace_role_permissions(
                self.admin_role.id,
                RolePermissionsReplace(permissions=["users:read"]),
                self.session,
                self.actor,
                True,
            )
        self._assert_blocked(ctx.exception)

    def test_deleting_system_role_is_blocked(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            delete_role(self.admin_role.id, self.session, self.actor, True)
        self._assert_blocked(ctx.exception)

    def test_deactivating_last_admin_user_is_blocked(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            delete_user(self.admin.id, self.session, self.actor, True)
        self._assert_blocked(ctx.exception)

    def test_second_admin_allows_removing_first(self) -> None:
        backup = self._add_user("backup@example.com", self.admin_role)
        self.session.commit()
        # Con un segundo administrador, dar de baja al primero no rompe la cobertura.
        delete_user(self.admin.id, self.session, self.actor, True)
        self.session.refresh(self.admin)
        self.assertFalse(self.admin.is_active)
        self.assertIsNotNone(backup.id)


if __name__ == "__main__":
    unittest.main()
