"""Tests del autofiltro por valores (facetas) y de los agregados de recursos.

Dos capas:
- Unit (SQLite): semántica del motor — ``apply_filter_predicates`` con
  ``exclude_field`` (la faceta de una columna ignora SU propio filtro y respeta
  el de las demás), orden por frecuencia, ``has_more`` y agregados.
- Endpoint (PostgreSQL, TEST_POSTGRES_URL): contrato HTTP de
  ``/api/v1/resources/{name}/facets`` y ``/stats`` — RBAC opaco (404), allowlist
  de campos (422), serialización string de valores y reuso del query schema
  compilado para los filtros activos.
"""

import os
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

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, delete, select  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlmodel import Session  # noqa: E402

from backend.app.auth.auth_dependencies import get_current_user  # noqa: E402
from backend.app.core.database import get_db  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.app.models import Base  # noqa: E402
from backend.app.models.backup import BackupRun  # noqa: E402
from backend.app.models.user import User  # noqa: E402
from backend.app.query.facets import aggregate_stats, facet_values  # noqa: E402
from backend.app.query.validation import QueryParameterError  # noqa: E402
from backend.app.resources.registry import BACKUP_RUNS, USERS  # noqa: E402
from backend.app.schemas.user import SessionUser  # noqa: E402

_TEST_PG_URL = os.environ.get("TEST_POSTGRES_URL", "")


def _is_test_url(url: str) -> bool:
    if not url:
        return False
    db_name = (urlparse(url).path or "/").lstrip("/")
    return db_name.endswith("_test")


def _user(name: str, email: str, *, active: bool = True) -> User:
    return User(
        name=name,
        last_name="Prueba",
        email=email,
        hashed_password="x",
        token="t-" + uuid.uuid4().hex,
        is_active=active,
    )


class FacetValuesUnitTest(unittest.TestCase):
    """Semántica del motor sobre SQLite (sin HTTP): exclusión del filtro propio,
    orden por frecuencia, has_more y agregados en una sola consulta."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(cls.engine)
        with Session(cls.engine) as session:
            session.add_all(
                [
                    _user("Ana", "ana1@example.com"),
                    _user("Ana", "ana2@example.com"),
                    _user("Beto", "beto@example.com"),
                    _user("Caro", "caro@example.com", active=False),
                    _user("Dario", "dario@example.com", active=False),
                ]
            )
            session.commit()

    def _facet(self, field: str, **params):  # type: ignore[no-untyped-def]
        query = USERS.Query(**params)
        with Session(self.engine) as session:
            return facet_values(
                session,
                stmt=select(User),
                query=query,
                plan=USERS.plan,
                field_name=field,
            )

    def test_counts_ordered_by_frequency_then_value(self) -> None:
        result = self._facet("name")
        self.assertEqual(
            [(value, count) for value, count in result.values],
            [("Ana", 2), ("Beto", 1), ("Caro", 1), ("Dario", 1)],
        )
        self.assertFalse(result.has_more)
        self.assertEqual(result.null_count, 0)

    def test_excludes_own_filter_but_respects_others(self) -> None:
        # Con is_active=False activo: la faceta de is_active sigue mostrando AMBOS
        # valores (excluye su propio filtro), pero la de name solo ve inactivos.
        own = self._facet("is_active", is_active=False)
        self.assertEqual({value: count for value, count in own.values}, {True: 3, False: 2})

        others = self._facet("name", is_active=False)
        self.assertEqual([value for value, _ in others.values], ["Caro", "Dario"])

    def test_in_filter_of_other_field_applies(self) -> None:
        result = self._facet("email", name_in=["Ana"])
        self.assertEqual(
            sorted(value for value, _ in result.values),
            ["ana1@example.com", "ana2@example.com"],
        )

    def test_has_more_reports_truncation(self) -> None:
        query = USERS.Query()
        with Session(self.engine) as session:
            result = facet_values(
                session,
                stmt=select(User),
                query=query,
                plan=USERS.plan,
                field_name="name",
                limit=2,
            )
        self.assertEqual(len(result.values), 2)
        self.assertTrue(result.has_more)

    def test_rejects_field_without_eq_or_in(self) -> None:
        with self.assertRaises(QueryParameterError):
            self._facet("created_at")

    def test_aggregate_stats_respects_all_filters(self) -> None:
        with Session(self.engine) as session:
            session.execute(delete(BackupRun))
            session.add_all(
                [
                    BackupRun(status="succeeded", trigger_kind="manual", file_size_bytes=100),
                    BackupRun(status="succeeded", trigger_kind="scheduled", file_size_bytes=300),
                    BackupRun(status="failed", trigger_kind="manual", file_size_bytes=None),
                ]
            )
            session.commit()
            result = aggregate_stats(
                session,
                stmt=select(BackupRun),
                query=BACKUP_RUNS.Query(status="succeeded"),
                plan=BACKUP_RUNS.plan,
                field_names=("file_size_bytes",),
            )
        self.assertEqual(result.count, 2)
        stats = result.fields["file_size_bytes"]
        self.assertEqual(stats.sum, 400.0)
        self.assertEqual(stats.avg, 200.0)
        self.assertEqual(stats.min, 100.0)
        self.assertEqual(stats.max, 300.0)


@unittest.skipUnless(
    _is_test_url(_TEST_PG_URL),
    "TEST_POSTGRES_URL no definida o no apunta a una base *_test.",
)
class FacetsEndpointTest(unittest.TestCase):
    """Contrato HTTP de /resources/{name}/facets y /stats sobre PostgreSQL real."""

    _EMAIL_DOMAIN = "@facets.test"

    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_engine(_TEST_PG_URL)
        Base.metadata.create_all(cls.engine)

    def setUp(self) -> None:
        with Session(self.engine) as session:
            session.execute(
                delete(User).where(User.email.like(f"%{self._EMAIL_DOMAIN}"))
            )
            session.execute(delete(BackupRun))
            session.add_all(
                [
                    _user("Ana", f"ana1{self._EMAIL_DOMAIN}"),
                    _user("Ana", f"ana2{self._EMAIL_DOMAIN}"),
                    _user("Beto", f"beto{self._EMAIL_DOMAIN}", active=False),
                ]
            )
            session.add_all(
                [
                    BackupRun(status="succeeded", trigger_kind="manual", file_size_bytes=100),
                    BackupRun(status="succeeded", trigger_kind="scheduled", file_size_bytes=300),
                    BackupRun(status="failed", trigger_kind="manual", file_size_bytes=700),
                ]
            )
            session.commit()

        def override_db():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def _as(self, *permissions: str) -> None:
        app.dependency_overrides[get_current_user] = lambda: SessionUser(
            id=uuid.uuid4(),
            name="Admin",
            last_name="Prueba",
            email="admin@example.com",
            permissions=set(permissions),
        )

    def test_facets_serializes_values_as_strings(self) -> None:
        self._as("users:read")
        resp = self.client.get("/api/v1/resources/users/facets", params={"field": "is_active"})
        self.assertEqual(resp.status_code, 200, resp.text)
        body = resp.json()
        self.assertEqual(body["field"], "is_active")
        counts = {entry["value"]: entry["count"] for entry in body["values"]}
        # Otros tests/bootstrap pueden haber sembrado usuarios activos adicionales:
        # se asegura el piso de ESTE seed sin exigir un universo exacto.
        self.assertGreaterEqual(counts.get("true", 0), 2)
        self.assertGreaterEqual(counts.get("false", 0), 1)
        self.assertFalse(body["has_more"])

    def test_facets_excludes_own_filter_and_respects_others(self) -> None:
        self._as("users:read")
        resp = self.client.get(
            "/api/v1/resources/users/facets",
            params={"field": "name", "is_active": "true", "q": "facets.test"},
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        counts = {entry["value"]: entry["count"] for entry in resp.json()["values"]}
        self.assertEqual(counts, {"Ana": 2})

    def test_facets_accepts_repeated_in_parameter(self) -> None:
        self._as("users:read")
        resp = self.client.get(
            "/api/v1/resources/users/facets",
            params=[("field", "email"), ("name_in", "Ana"), ("q", "facets.test")],
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        values = sorted(entry["value"] for entry in resp.json()["values"])
        self.assertEqual(values, [f"ana1{self._EMAIL_DOMAIN}", f"ana2{self._EMAIL_DOMAIN}"])

    def test_facets_unknown_or_untyped_field_is_422(self) -> None:
        self._as("users:read")
        for field in ("created_at", "no_existe"):
            resp = self.client.get(
                "/api/v1/resources/users/facets", params={"field": field}
            )
            self.assertEqual(resp.status_code, 422, resp.text)
            self.assertIn("field_not_facetable", resp.text)

    def test_facets_invalid_filter_value_is_422(self) -> None:
        self._as("users:read")
        resp = self.client.get(
            "/api/v1/resources/users/facets",
            params={"field": "name", "is_active": "no-es-bool"},
        )
        self.assertEqual(resp.status_code, 422, resp.text)
        self.assertIn("invalid_query", resp.text)

    def test_facets_without_permission_is_opaque_404(self) -> None:
        self._as()  # sin permisos
        resp = self.client.get("/api/v1/resources/users/facets", params={"field": "name"})
        self.assertEqual(resp.status_code, 404, resp.text)
        # Mismo cuerpo que un recurso inexistente (no revela el catálogo).
        unknown = self.client.get(
            "/api/v1/resources/no-existe/facets", params={"field": "x"}
        )
        self.assertEqual(resp.json(), unknown.json())

    def test_stats_aggregates_under_active_filters(self) -> None:
        self._as("backups:read")
        resp = self.client.get(
            "/api/v1/resources/backup_runs/stats",
            params={"fields": "file_size_bytes", "status": "succeeded"},
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        body = resp.json()
        self.assertEqual(body["count"], 2)
        stats = body["fields"]["file_size_bytes"]
        self.assertEqual(stats["sum"], 400.0)
        self.assertEqual(stats["avg"], 200.0)
        self.assertEqual(stats["min"], 100.0)
        self.assertEqual(stats["max"], 300.0)

    def test_stats_rejects_non_numeric_field(self) -> None:
        self._as("backups:read")
        resp = self.client.get(
            "/api/v1/resources/backup_runs/stats", params={"fields": "status"}
        )
        self.assertEqual(resp.status_code, 422, resp.text)
        self.assertIn("field_not_aggregable", resp.text)


if __name__ == "__main__":
    unittest.main()
