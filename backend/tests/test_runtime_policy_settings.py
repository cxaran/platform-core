"""Política operativa editable en runtime: helpers *_effective y resolver de TZ.

Verifica la convención NULL = default del despliegue para los campos movidos a
``system_settings``/``backup_settings`` (intentos de bloqueo, TTL de tokens de
correo, zona horaria, TTLs del copiloto, lease/reintentos de respaldos) y el
resolver inyectable de zona horaria del motor de query.
"""

import os
import unittest


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
    "APPLICATION_TIMEZONE": "UTC",
}

os.environ.update(DEV_ENV)

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlmodel import Session  # noqa: E402

from backend.app.core.settings import settings  # noqa: E402
from backend.app.models import Base  # noqa: E402
from backend.app.models.system_settings import SystemSettings  # noqa: E402
from backend.app.query.compiler import set_calendar_timezone_resolver, _resolve_calendar_tz  # noqa: E402
from backend.app.services import system_settings_service as system  # noqa: E402


def _make_session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return Session(engine)


class EffectivePolicyHelpersTest(unittest.TestCase):
    def setUp(self) -> None:
        self.session = _make_session()

    def tearDown(self) -> None:
        self.session.close()

    def _row(self) -> SystemSettings:
        return system.get_system_settings(self.session)

    def test_null_falls_back_to_deployment_defaults(self) -> None:
        # Fila recién creada: todo NULL -> valores del entorno.
        self.assertEqual(
            system.trys_before_lock_effective(self.session), settings.trys_before_lock
        )
        self.assertEqual(
            system.email_token_minutes_effective(self.session),
            settings.email_token_expire_minutes,
        )
        self.assertEqual(
            system.application_timezone_effective(self.session),
            settings.application_timezone,
        )
        self.assertEqual(
            system.agent_ticket_ttl_effective(self.session),
            settings.agent_gateway_ticket_ttl_seconds,
        )
        self.assertEqual(
            system.agent_lease_ttl_effective(self.session),
            settings.agent_gateway_lease_ttl_seconds,
        )

    def test_stored_policy_wins_over_environment(self) -> None:
        row = self._row()
        row.login_attempts_before_lock = 3
        row.email_token_minutes = 15
        row.application_timezone = "America/Monterrey"
        row.agent_ticket_ttl_seconds = 60
        row.agent_lease_ttl_seconds = 120
        self.session.add(row)
        self.session.flush()

        self.assertEqual(system.trys_before_lock_effective(self.session), 3)
        self.assertEqual(system.email_token_minutes_effective(self.session), 15)
        self.assertEqual(
            system.application_timezone_effective(self.session), "America/Monterrey"
        )
        self.assertEqual(system.agent_ticket_ttl_effective(self.session), 60)
        self.assertEqual(system.agent_lease_ttl_effective(self.session), 120)

    def test_invalid_stored_timezone_falls_back(self) -> None:
        # Defensa: una zona corrupta en BD no debe romper los filtros de fecha.
        row = self._row()
        row.application_timezone = "No/Existe"
        self.session.add(row)
        self.session.flush()
        self.assertEqual(
            system.application_timezone_effective(self.session),
            settings.application_timezone,
        )

    def test_project_display_name_prefers_institution(self) -> None:
        self.assertEqual(
            system.project_display_name(self.session), settings.project_name
        )
        row = self._row()
        row.institution_name = "  Clínica Aurora  "
        self.session.add(row)
        self.session.flush()
        self.assertEqual(system.project_display_name(self.session), "Clínica Aurora")


class BackupPolicyHelpersTest(unittest.TestCase):
    def setUp(self) -> None:
        self.session = _make_session()

    def tearDown(self) -> None:
        self.session.close()

    def test_backup_helpers_fallback_and_override(self) -> None:
        from datetime import time

        from backend.app.models.backup import BackupSettings
        from backend.app.services.backup_service import (
            max_attempts_effective,
            run_lease_minutes_effective,
        )

        # Sin fila singleton: fallback al despliegue (el worker no debe morir).
        self.assertEqual(
            run_lease_minutes_effective(self.session), settings.backup_run_lease_minutes
        )
        self.assertEqual(
            max_attempts_effective(self.session), settings.backup_max_attempts
        )

        row = BackupSettings(
            enabled=False,
            timezone="UTC",
            daily_time=time(3, 0),
            filename_prefix="respaldo",
            retention_daily_count=7,
            retention_monthly_count=12,
            retention_yearly_count=5,
            run_lease_minutes=45,
            max_attempts=2,
        )
        self.session.add(row)
        self.session.flush()

        self.assertEqual(run_lease_minutes_effective(self.session), 45)
        self.assertEqual(max_attempts_effective(self.session), 2)


class CalendarTimezoneResolverTest(unittest.TestCase):
    def tearDown(self) -> None:
        set_calendar_timezone_resolver(None)

    def test_without_resolver_uses_plan_snapshot(self) -> None:
        set_calendar_timezone_resolver(None)
        self.assertEqual(str(_resolve_calendar_tz("America/Mexico_City")), "America/Mexico_City")

    def test_resolver_overrides_plan_snapshot(self) -> None:
        set_calendar_timezone_resolver(lambda: "America/Monterrey")
        self.assertEqual(str(_resolve_calendar_tz("UTC")), "America/Monterrey")

    def test_broken_resolver_falls_back_to_plan(self) -> None:
        def broken() -> str:
            raise RuntimeError("db caída")

        set_calendar_timezone_resolver(broken)
        self.assertEqual(str(_resolve_calendar_tz("UTC")), "UTC")

    def test_invalid_zone_from_resolver_falls_back_to_plan(self) -> None:
        set_calendar_timezone_resolver(lambda: "No/Existe")
        self.assertEqual(str(_resolve_calendar_tz("UTC")), "UTC")


if __name__ == "__main__":
    unittest.main()
