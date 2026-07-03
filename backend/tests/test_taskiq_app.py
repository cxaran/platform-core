"""Tests del módulo Taskiq (backend/app/taskiq_app.py).

Unitarios: conversión de DSN e importación aislada (el módulo no arrastra la
aplicación FastAPI ni abre conexiones al importarse; la única tarea es backups.tick).
Integración (requiere TEST_POSTGRES_URL apuntando a una base *_test): ciclo
startup/shutdown de un broker temporal con canal y tabla únicos. Sin worker
subprocess, sin ejecutar tareas reales y sin tocar la base de desarrollo.
"""

import asyncio
import os
import sys
import unittest
import uuid
from urllib.parse import urlparse


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

from backend.app.taskiq_app import taskiq_dsn  # noqa: E402


_TEST_PG_URL = os.environ.get("TEST_POSTGRES_URL", "")


def _is_test_url(url: str) -> bool:
    if not url:
        return False
    db_name = (urlparse(url).path or "/").lstrip("/")
    return db_name.endswith("_test")


class TaskiqDsnTest(unittest.TestCase):
    def test_converts_driver_to_plain_postgresql(self) -> None:
        self.assertEqual(
            taskiq_dsn("postgresql+psycopg://user:password@host:5432/database"),
            "postgresql://user:password@host:5432/database",
        )

    def test_converts_project_psycopg2_dsn(self) -> None:
        # El DSN real del proyecto usa el driver psycopg2 de SQLAlchemy.
        self.assertEqual(
            taskiq_dsn("postgresql+psycopg2://user:password@host:5432/database"),
            "postgresql://user:password@host:5432/database",
        )

    def test_preserves_query_parameters(self) -> None:
        # make_url serializa los query params en orden alfabético; lo que importa es
        # que TODOS se conserven con sus valores.
        self.assertEqual(
            taskiq_dsn(
                "postgresql+psycopg://user:password@host:5432/database"
                "?sslmode=require&application_name=mp"
            ),
            "postgresql://user:password@host:5432/database"
            "?application_name=mp&sslmode=require",
        )


class IsolatedImportTest(unittest.TestCase):
    def test_module_exposes_broker_scheduler_and_task_without_side_effects(self) -> None:
        # El import de arriba ya ocurrió con un POSTGRES_SERVER inexistente en local:
        # si el módulo abriera una conexión o ejecutara broker.startup() al importarse,
        # este archivo habría fallado antes de llegar aquí. El ciclo de vida del broker
        # lo maneja el CLI de taskiq en el proceso del worker/scheduler.
        module = sys.modules["backend.app.taskiq_app"]
        self.assertTrue(hasattr(module, "broker"))
        self.assertTrue(hasattr(module, "scheduler"))
        # La única tarea real (backups.tick) queda registrada vía jobs/tasks/backups.
        from backend.app.jobs.tasks.backups import backups_tick

        self.assertEqual(backups_tick.task_name, "backups.tick")

    def test_import_does_not_pull_the_fastapi_application(self) -> None:
        # En un PROCESO limpio (otros archivos de test importan app.main en esta misma
        # sesión de pytest): importar el módulo Taskiq no arrastra la aplicación web.
        import subprocess

        code = (
            "import sys; import backend.app.taskiq_app; "
            "assert 'backend.app.main' not in sys.modules, 'main importado'; "
            "assert 'backend.app.api' not in sys.modules, 'api importada'; "
            "print('aislado')"
        )
        result = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            env={**os.environ, **DEV_ENV},
            timeout=120,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("aislado", result.stdout)


@unittest.skipUnless(
    _is_test_url(_TEST_PG_URL),
    "TEST_POSTGRES_URL no definida o no apunta a una base *_test.",
)
class TaskiqPostgresIntegrationTest(unittest.TestCase):
    def test_broker_startup_and_shutdown_with_temporary_channel_and_table(self) -> None:
        from sqlalchemy import create_engine, inspect, text

        from taskiq_pg.psycopg import PsycopgBroker

        suffix = uuid.uuid4().hex[:12]
        table_name = f"taskiq_test_messages_{suffix}"
        broker = PsycopgBroker(
            dsn=taskiq_dsn(_TEST_PG_URL),
            channel_name=f"taskiq_test_channel_{suffix}",
            table_name=table_name,
        )
        engine = create_engine(_TEST_PG_URL)
        try:

            async def cycle() -> None:
                await broker.startup()
                await broker.shutdown()

            # psycopg async no soporta el ProactorEventLoop por defecto de Windows;
            # en Linux/Docker (donde corre el worker real) no cambia nada.
            if sys.platform == "win32":
                asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
            asyncio.run(cycle())
            # El startup materializa la tabla de mensajes del broker (y nada más).
            self.assertIn(table_name, inspect(engine).get_table_names())
        finally:
            with engine.begin() as connection:
                connection.execute(
                    text(f'DROP TABLE IF EXISTS "{table_name}"')
                )
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
