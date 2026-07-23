"""Tests PostgreSQL de los operadores/estrategias que dependen del motor real:

- Operadores de columna ARRAY: ``contains_any`` (``&&``) y ``contains_all`` (``@>``).
- Búsqueda ``UNACCENT`` (insensible a acentos) — extensión ``unaccent``.
- Búsqueda ``TRIGRAM`` (similitud difusa) — extensión ``pg_trgm``.

Solo se ejecutan si ``TEST_POSTGRES_URL`` apunta a una base cuyo nombre termina en
``_test`` (misma salvaguarda que ``test_query_postgres``). Las extensiones se crean en
``setUpClass`` (en producción viven en la migración inicial).
"""

import os
import unittest
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Integer, String, create_engine, select, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

os.environ.setdefault("ENVIRONMENT", "local")
os.environ.setdefault("SECRET_KEY", "test-secret-key-test-secret-key")
os.environ.setdefault("ACCESS_TOKEN_EXPIRE_MINUTES", "30")
os.environ.setdefault("EMAIL_TOKEN_EXPIRE_MINUTES", "30")
os.environ.setdefault("TRYS_BEFORE_LOCK", "5")
os.environ.setdefault("REDIS_HOST", "redis")
os.environ.setdefault("REDIS_PORT", "6379")
os.environ.setdefault("REDIS_DB", "0")
os.environ.setdefault("SMTP_HOST", "mailpit")
os.environ.setdefault("SMTP_PORT", "1025")
os.environ.setdefault("SMTP_USER", "test@example.com")
os.environ.setdefault("SMTP_PASSWORD", "test-password")
os.environ.setdefault("SMTP_FROM_EMAIL", "test@example.com")
os.environ.setdefault("SMTP_FROM_NAME", "Platform Core Test")
os.environ.setdefault("SMTP_TLS", "false")
os.environ.setdefault("SMTP_SSL", "false")
os.environ.setdefault("SMTP_USE_CREDENTIALS", "false")
os.environ.setdefault("POSTGRES_USER", "platform")
os.environ.setdefault("POSTGRES_PASSWORD", "platform")
os.environ.setdefault("POSTGRES_SERVER", "postgres")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("POSTGRES_DB", "platform_core")

from backend.app.query import QueryOptions, paginate  # noqa: E402
from backend.app.query.factory import compile_list_query  # noqa: E402
from backend.app.query.operators import Operator  # noqa: E402
from backend.app.query.search import SearchMode  # noqa: E402


class _Base(DeclarativeBase):
    pass


class PgTagged(_Base):
    __tablename__ = "pg_tagged"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    tags: Mapped[list] = mapped_column(ARRAY(String), nullable=False)


class PgTaggedRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    tags: list[str]


_TEST_PG_URL = os.environ.get("TEST_POSTGRES_URL", "")


def _is_test_url(url: str) -> bool:
    if not url:
        return False
    db_name = (urlparse(url).path or "/").lstrip("/")
    return db_name.endswith("_test")


@unittest.skipUnless(
    _is_test_url(_TEST_PG_URL),
    "TEST_POSTGRES_URL no definida o no apunta a una base *_test.",
)
class PgArrayAndSearchTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_engine(_TEST_PG_URL)
        with cls.engine.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS unaccent"))
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        _Base.metadata.create_all(cls.engine)

    @classmethod
    def tearDownClass(cls) -> None:
        _Base.metadata.drop_all(cls.engine)
        cls.engine.dispose()

    def setUp(self) -> None:
        with Session(self.engine) as session:
            session.add_all(
                [
                    PgTagged(id=1, name="José", tags=["admin", "editor"]),
                    PgTagged(id=2, name="Ana", tags=["viewer"]),
                    PgTagged(id=3, name="Jose", tags=["admin", "viewer"]),
                    PgTagged(id=4, name="Mario", tags=["editor"]),
                ]
            )
            session.commit()

    def tearDown(self) -> None:
        with Session(self.engine) as session:
            session.query(PgTagged).delete()
            session.commit()

    def _names(self, options: QueryOptions, **params: object) -> set[str]:
        compiled = compile_list_query(
            name="PgTaggedQuery",
            resource_schema=PgTaggedRead,
            orm_model=PgTagged,
            options=options,
        )
        query = compiled.schema(**params)  # type: ignore[arg-type]
        with Session(self.engine) as session:
            page = paginate(
                session,
                stmt=select(PgTagged),
                query=query,
                item_schema=PgTaggedRead,
                plan=compiled.plan,
            )
        return {item.name for item in page.items}

    # --- Operadores ARRAY ---
    _ARRAY_OPTIONS = QueryOptions(
        field_operators={"tags": (Operator.CONTAINS_ANY, Operator.CONTAINS_ALL)},
    )

    def test_contains_any_overlaps(self) -> None:
        # Cualquiera de {editor}: José (admin,editor) y Mario (editor).
        self.assertEqual(
            self._names(self._ARRAY_OPTIONS, tags_contains_any=["editor"]),
            {"José", "Mario"},
        )

    def test_contains_all_requires_every_value(self) -> None:
        # Contiene TODOS {admin, viewer}: solo Jose (id 3).
        self.assertEqual(
            self._names(self._ARRAY_OPTIONS, tags_contains_all=["admin", "viewer"]),
            {"Jose"},
        )

    def test_contains_any_multiple_values(self) -> None:
        self.assertEqual(
            self._names(self._ARRAY_OPTIONS, tags_contains_any=["viewer", "editor"]),
            {"José", "Ana", "Jose", "Mario"},
        )

    # --- Búsqueda UNACCENT ---
    _UNACCENT_OPTIONS = QueryOptions(
        search_fields=("name",), search_mode=SearchMode.UNACCENT
    )

    def test_unaccent_search_ignores_accents(self) -> None:
        # "jose" sin acento encuentra "José" y "Jose".
        self.assertEqual(
            self._names(self._UNACCENT_OPTIONS, q="jose"), {"José", "Jose"}
        )

    # --- Búsqueda TRIGRAM ---
    _TRIGRAM_OPTIONS = QueryOptions(
        search_fields=("name",), search_mode=SearchMode.TRIGRAM
    )

    def test_trigram_search_tolerates_typos(self) -> None:
        # "Marino" (errata) debe acercarse a "Mario" por similitud de trigramas.
        with Session(self.engine) as session:
            session.execute(text("SET pg_trgm.similarity_threshold = 0.3"))
            session.commit()
        result = self._names(self._TRIGRAM_OPTIONS, q="Mari")
        self.assertIn("Mario", result)


if __name__ == "__main__":
    unittest.main()
