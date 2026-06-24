"""Tests de PostgreSQL: compilación SQL con dialecto PG e integración real.

Los tests de compilación (``PgCompileTest``) siempre se ejecutan y validan
que el SQL generado use ILIKE, ESCAPE, NULLS LAST y el desempate por PK
correctamente cuando se compila con el dialecto PostgreSQL.

Los tests de integración (``PgIntegrationTest``) solo se ejecutan si existe
la variable de entorno ``TEST_POSTGRES_URL`` y apunta a una base de datos
cuyo nombre termine en ``_test``.  Esto evita conectar por accidente a una
base de desarrollo o producción.

Ejemplo de uso dentro del contenedor backend::

    docker compose -f compose.dev.yml exec -e \
        TEST_POSTGRES_URL="postgresql+psycopg2://platform:platform@postgres:5432/platform_core_test" \
        backend python -m unittest backend.tests.test_query_postgres
"""

import os
import unittest
from datetime import datetime
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict
from sqlalchemy import DateTime, Integer, String, create_engine, func, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from backend.app.query import OffsetPage, QueryOptions, paginate
from backend.app.query.compiler import apply_query_schema
from backend.app.query.factory import make_offset_query_schema


class _PgBase(DeclarativeBase):
    pass


class PgWidget(_PgBase):
    __tablename__ = "pg_widget"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    price: Mapped[int] = mapped_column(Integer, nullable=False)
    category: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)


class PgWidgetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    price: int
    category: str | None
    created_at: datetime | None


_PgWidgetQuery = make_offset_query_schema(
    name="PgWidgetQuery",
    resource_schema=PgWidgetRead,
    orm_model=PgWidget,
    options=QueryOptions(
        filter_fields=("name", "price", "category"),
        sort_fields=("id", "name", "price", "category", "created_at"),
        search_fields=("name",),
        in_fields=("price",),
        null_filter_fields=("category",),
    ),
)


def _pg_compile(stmt: object) -> str:
    return str(stmt.compile(dialect=postgresql.dialect()))  # type: ignore[arg-type]


class PgCompileTest(unittest.TestCase):
    """Compila queries con dialecto PostgreSQL y verifica las cláusulas
    específicas de PG (ILIKE, ESCAPE, NULLS LAST).  No requiere conexión."""

    def test_search_uses_ilike_with_escape(self) -> None:
        query = _PgWidgetQuery(q="100%off", sort="id")  # type: ignore[arg-type]
        stmt = apply_query_schema(stmt=select(PgWidget), query=query)
        sql = _pg_compile(stmt)

        self.assertIn("ILIKE", sql)
        self.assertIn("ESCAPE", sql)

    def test_ascending_sort_uses_nulls_last(self) -> None:
        query = _PgWidgetQuery(sort="category")  # type: ignore[arg-type]
        stmt = apply_query_schema(stmt=select(PgWidget), query=query)
        sql = _pg_compile(stmt).upper()

        self.assertIn("NULLS LAST", sql)
        self.assertIn("ASC", sql)

    def test_descending_sort_uses_nulls_last(self) -> None:
        query = _PgWidgetQuery(sort="-category")  # type: ignore[arg-type]
        stmt = apply_query_schema(stmt=select(PgWidget), query=query)
        sql = _pg_compile(stmt).upper()

        self.assertIn("NULLS LAST", sql)
        self.assertIn("DESC", sql)

    def test_pk_tiebreaker_appears_in_order_by(self) -> None:
        query = _PgWidgetQuery(sort="price")  # type: ignore[arg-type]
        stmt = apply_query_schema(stmt=select(PgWidget), query=query)
        sql = _pg_compile(stmt).upper()

        self.assertIn("ORDER BY", sql)
        self.assertIn("PG_WIDGET.ID", sql)

    def test_count_statement_has_no_order_by(self) -> None:
        query = _PgWidgetQuery(sort="price", limit=10)  # type: ignore[arg-type]
        filtered = apply_query_schema(stmt=select(PgWidget), query=query)
        count_stmt = select(func.count()).select_from(filtered.order_by(None).subquery())
        sql = _pg_compile(count_stmt).upper()

        self.assertNotIn("ORDER BY", sql)


_TEST_PG_URL = os.environ.get("TEST_POSTGRES_URL", "")


def _is_test_url(url: str) -> bool:
    if not url:
        return False
    parsed = urlparse(url)
    db_name = (parsed.path or "/").lstrip("/")
    return db_name.endswith("_test")


@unittest.skipUnless(
    _is_test_url(_TEST_PG_URL),
    "TEST_POSTGRES_URL no definida o no apunta a una base *_test. "
    "Ej: postgresql+psycopg2://user:pass@host:5432/platform_core_test",
)
class PgIntegrationTest(unittest.TestCase):
    """Ejecuta queries contra un PostgreSQL real de pruebas."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_engine(_TEST_PG_URL)
        _PgBase.metadata.create_all(cls.engine)

    @classmethod
    def tearDownClass(cls) -> None:
        _PgBase.metadata.drop_all(cls.engine)
        cls.engine.dispose()

    def setUp(self) -> None:
        with Session(self.engine) as session:
            session.add_all(
                [
                    PgWidget(id=1, name="Alpha", price=10, category="tools", created_at=datetime(2024, 1, 1)),
                    PgWidget(id=2, name="beta", price=20, category=None, created_at=datetime(2024, 1, 2)),
                    PgWidget(id=3, name="Gamma", price=30, category="tools", created_at=datetime(2024, 1, 3)),
                    PgWidget(id=4, name="delta", price=40, category=None, created_at=datetime(2024, 1, 1)),
                    PgWidget(id=5, name="100%_off", price=50, category="gear", created_at=datetime(2024, 1, 2)),
                    PgWidget(id=6, name="100Xoff", price=60, category="gear", created_at=datetime(2024, 1, 3)),
                    PgWidget(id=7, name="discount_50", price=70, category="tools", created_at=datetime(2024, 1, 1)),
                    PgWidget(id=8, name="discountA50", price=80, category="tools", created_at=datetime(2024, 1, 2)),
                ]
            )
            session.commit()

    def tearDown(self) -> None:
        with Session(self.engine) as session:
            session.query(PgWidget).delete()
            session.commit()

    def _paginate(self, **params: object) -> OffsetPage[PgWidgetRead]:
        query = _PgWidgetQuery(**params)  # type: ignore[arg-type]
        with Session(self.engine) as session:
            return paginate(session, stmt=select(PgWidget), query=query, item_schema=PgWidgetRead)

    def test_ilike_is_case_insensitive(self) -> None:
        page = self._paginate(q="alpha", sort="id")
        names = [item.name for item in page.items]
        self.assertIn("Alpha", names)
        self.assertNotIn("beta", names)

    def test_nulls_last_on_ascending_sort(self) -> None:
        page = self._paginate(sort="category", limit=10)
        categories = [item.category for item in page.items]

        non_null = [c for c in categories if c is not None]
        null_count = sum(1 for c in categories if c is None)
        self.assertEqual(non_null, sorted(non_null))
        self.assertTrue(all(c is not None for c in categories[: len(categories) - null_count]))

    def test_percent_is_literal_not_wildcard(self) -> None:
        page = self._paginate(q="100%", sort="id")
        names = [item.name for item in page.items]
        self.assertEqual(names, ["100%_off"])

    def test_underscore_is_literal_not_wildcard(self) -> None:
        page = self._paginate(q="_50", sort="id")
        names = [item.name for item in page.items]
        self.assertEqual(names, ["discount_50"])

    def test_pagination_with_tiebreaker_no_duplicates(self) -> None:
        seen_ids: list[int] = []
        for offset_val in (0, 2, 4, 6, 8):
            page = self._paginate(limit=2, offset=offset_val, sort="created_at")
            seen_ids.extend(item.id for item in page.items)

        self.assertEqual(len(seen_ids), len(set(seen_ids)))
        self.assertEqual(sorted(seen_ids), [1, 2, 3, 4, 5, 6, 7, 8])

    def test_total_coherent_with_base_filter_and_user_filter(self) -> None:
        base_stmt = select(PgWidget).where(PgWidget.category != "gear")
        query = _PgWidgetQuery(price_gte=30, sort="price", limit=10)  # type: ignore[arg-type]
        with Session(self.engine) as session:
            page = paginate(session, stmt=base_stmt, query=query, item_schema=PgWidgetRead)

        # Lógica trivaluada de SQL: `category != 'gear'` excluye también las filas
        # con `category IS NULL` (id=4), por eso no aparece. id=5/6 son 'gear';
        # de los 'tools' restantes (1,3,7,8) el filtro price_gte=30 deja 3,7,8.
        ids = [item.id for item in page.items]
        self.assertEqual(sorted(ids), [3, 7, 8])
        self.assertEqual(page.pagination.total, 3)


if __name__ == "__main__":
    unittest.main()
