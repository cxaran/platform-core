"""Fase 2 — Paso 5: IdentitySpec, count strategies, serializers, SearchStrategy.

Verifica que los defaults reproducen el comportamiento actual y que las estrategias
opt-in funcionan: DistinctIdentityCount cuenta entidades únicas en joins 1:N,
ProjectionSerializer/CustomSerializer serializan filas no-entidad, y una
SearchStrategy custom reemplaza el ILIKE.
"""

import unittest
from typing import Any

from pydantic import BaseModel, ConfigDict
from sqlalchemy import ForeignKey, Integer, String, create_engine, or_, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from backend.app.query import (
    DistinctIdentityCount,
    IdentitySpec,
    ListQueryContract,
    NoTotalCount,
    ProjectionSerializer,
    QueryOptions,
)
from backend.app.query.compiler import apply_query_schema


class Base(DeclarativeBase):
    pass


class Parent(Base):
    __tablename__ = "parent"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)


class Child(Base):
    __tablename__ = "child"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    parent_id: Mapped[int] = mapped_column(ForeignKey("parent.id"), nullable=False)


class ParentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class ParentProjection(BaseModel):
    id: int
    name: str


_OPTIONS = QueryOptions(filter_fields=("name",), sort_fields=("id", "name"), default_sort="id")


def _engine() -> Any:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add_all([Parent(id=1, name="a"), Parent(id=2, name="b")])
        session.add_all(
            [Child(id=1, parent_id=1), Child(id=2, parent_id=1), Child(id=3, parent_id=2)]
        )
        session.commit()
    return engine


class IdentitySpecTest(unittest.TestCase):
    def test_from_model_uses_primary_key(self) -> None:
        spec = IdentitySpec.from_model(Parent)
        self.assertEqual([column.key for column in spec.columns], ["id"])

    def test_plan_identity_defaults_to_pk(self) -> None:
        contract = ListQueryContract(name="P", model=Parent, schema=ParentRead, options=_OPTIONS)
        self.assertEqual([c.key for c in contract.plan.identity.columns], ["id"])


class CountStrategyTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = _engine()
        self.base = select(Parent).join(Child, Child.parent_id == Parent.id)

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)

    def test_automatic_count_counts_joined_rows(self) -> None:
        contract = ListQueryContract(name="Auto", model=Parent, schema=ParentRead, options=_OPTIONS)
        with Session(self.engine) as session:
            page = contract.paginate(session, contract.Query(sort="id"), stmt=self.base)  # type: ignore[arg-type]
        # El join 1:N duplica filas: 3 hijos -> total 3 (comportamiento default).
        self.assertEqual(page.pagination.total, 3)

    def test_distinct_identity_count_counts_unique_entities(self) -> None:
        contract = ListQueryContract(
            name="Distinct",
            model=Parent,
            schema=ParentRead,
            options=_OPTIONS,
            count_strategy=DistinctIdentityCount(),
        )
        with Session(self.engine) as session:
            page = contract.paginate(session, contract.Query(sort="id"), stmt=self.base)  # type: ignore[arg-type]
        # COUNT(DISTINCT identidad) -> 2 padres únicos.
        self.assertEqual(page.pagination.total, 2)


class NoTotalCountTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = _engine()

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)

    def _contract(self) -> ListQueryContract[ParentRead]:
        return ListQueryContract(
            name="Feed",
            model=Parent,
            schema=ParentRead,
            options=_OPTIONS,
            count_strategy=NoTotalCount(),
        )

    def test_no_total_omits_count_and_flags_next_page(self) -> None:
        # 2 padres, limit=1: total None (no se cuenta) y hay página siguiente.
        with Session(self.engine) as session:
            page = self._contract().paginate(session, self._contract().Query(sort="id", limit=1))  # type: ignore[arg-type]
        self.assertIsNone(page.pagination.total)
        self.assertEqual(len(page.items), 1)
        self.assertTrue(page.pagination.has_next)

    def test_no_total_last_page_has_no_next(self) -> None:
        with Session(self.engine) as session:
            page = self._contract().paginate(
                session, self._contract().Query(sort="id", limit=1, offset=1)  # type: ignore[arg-type]
            )
        self.assertIsNone(page.pagination.total)
        self.assertEqual(len(page.items), 1)
        self.assertFalse(page.pagination.has_next)


class ProjectionSerializerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = _engine()

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)

    def test_projection_serializes_row_mapping(self) -> None:
        contract = ListQueryContract(
            name="Proj",
            model=Parent,
            schema=ParentProjection,
            options=_OPTIONS,
            row_serializer=ProjectionSerializer(),
        )
        projection = select(Parent.id, Parent.name)
        with Session(self.engine) as session:
            page = contract.paginate(session, contract.Query(sort="id"), stmt=projection)  # type: ignore[arg-type]
        self.assertTrue(all(isinstance(item, ParentProjection) for item in page.items))
        self.assertEqual([(i.id, i.name) for i in page.items], [(1, "a"), (2, "b")])


class SearchStrategyTest(unittest.TestCase):
    OPTIONS = QueryOptions(search_fields=("name",), sort_fields=("id",), default_sort="id")

    def _sql(self, contract: ListQueryContract[ParentRead]) -> str:
        query = contract.Query(q="alpha", sort="id")  # type: ignore[arg-type]
        stmt = apply_query_schema(stmt=select(Parent), query=query, plan=contract.plan)
        return str(stmt.compile(dialect=postgresql.dialect()))

    def test_default_is_ilike(self) -> None:
        contract = ListQueryContract(name="Ilike", model=Parent, schema=ParentRead, options=self.OPTIONS)
        self.assertIn("ILIKE", self._sql(contract).upper())

    def test_custom_search_strategy_replaces_ilike(self) -> None:
        class ExactSearch:
            def predicate(self, columns: tuple[Any, ...], value: str) -> Any:
                return or_(*(column == value for column in columns))

        contract = ListQueryContract(
            name="Exact",
            model=Parent,
            schema=ParentRead,
            options=self.OPTIONS,
            search_strategy=ExactSearch(),
        )
        sql = self._sql(contract).upper()
        self.assertNotIn("ILIKE", sql)
        self.assertIn("PARENT.NAME =", sql)


if __name__ == "__main__":
    unittest.main()
