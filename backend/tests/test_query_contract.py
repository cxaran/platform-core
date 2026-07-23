"""Fase 2 — Paso 3: ListQueryContract y ResourceQuery como fachada.

Cubre: (1) contrato por options preserva schema/SQL/resultados; (2) contrato por
policy funciona por el camino nuevo; (3) ResourceQuery conserva constructor/.Query/
.paginate; (4) stmt base con scope respetado; (5) el contrato usa su plan explícito
(no depende de la metadata __query_*__); (6) options+policy juntos -> error claro.
"""

import unittest

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Integer, String, create_engine, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from backend.app.query import ListQueryContract, QueryOptions, ResourceQuery
from backend.app.query.compiler import apply_query_schema
from backend.app.query.validation import QuerySchemaConfigError


class Base(DeclarativeBase):
    pass


class Widget(Base):
    __tablename__ = "widget"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    price: Mapped[int] = mapped_column(Integer, nullable=False)
    category: Mapped[str | None] = mapped_column(String, nullable=True)


class WidgetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    price: int
    category: str | None


OPTIONS = QueryOptions(
    filter_fields=("name", "price", "category"),
    sort_fields=("id", "name", "price", "category"),
    search_fields=("name",),
    in_fields=("price",),
    null_filter_fields=("category",),
    default_sort="-price",
)


def _engine_with_data():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add_all(
            [
                Widget(id=1, name="alpha", price=10, category="tools"),
                Widget(id=2, name="beta", price=20, category=None),
                Widget(id=3, name="gamma", price=30, category="tools"),
                Widget(id=4, name="delta", price=40, category="hidden"),
            ]
        )
        session.commit()
    return engine


def _options_contract() -> ListQueryContract[WidgetRead]:
    return ListQueryContract(name="WidgetOptionsQuery", model=Widget, schema=WidgetRead, options=OPTIONS)


def _policy_contract() -> ListQueryContract[WidgetRead]:
    policy = OPTIONS.to_policy(WidgetRead, Widget)
    return ListQueryContract(name="WidgetPolicyQuery", model=Widget, schema=WidgetRead, policy=policy)


class OptionsContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = _engine_with_data()
        self.contract = _options_contract()

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)

    def test_query_schema_has_expected_params(self) -> None:
        fields = set(self.contract.Query.model_fields)
        for expected in ("name", "price", "price_gte", "price_lte", "price_in", "category_isnull", "q", "limit", "offset", "sort"):
            self.assertIn(expected, fields)

    def test_paginate_items_total_offset_has_next(self) -> None:
        query = self.contract.Query(price_gte=20, sort="price", limit=2, offset=0)  # type: ignore[arg-type]
        with Session(self.engine) as session:
            page = self.contract.paginate(session, query)
        self.assertEqual([i.price for i in page.items], [20, 30])
        self.assertEqual(page.pagination.total, 3)
        self.assertEqual(page.pagination.offset, 0)
        self.assertTrue(page.pagination.has_next)


class PolicyContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = _engine_with_data()
        self.options_contract = _options_contract()
        self.policy_contract = _policy_contract()

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)

    def test_policy_schema_matches_options(self) -> None:
        self.assertEqual(
            set(self.policy_contract.Query.model_fields),
            set(self.options_contract.Query.model_fields),
        )

    def test_policy_filter_parameters_match_options(self) -> None:
        def params(contract: ListQueryContract[WidgetRead]) -> list[tuple[str, str, str]]:
            return [
                (p.field_name, p.operator.value, p.parameter_name)
                for p in contract.plan.filter_parameters
            ]

        self.assertEqual(params(self.options_contract), params(self.policy_contract))

    def test_policy_paginates_same_as_options(self) -> None:
        params = dict(price_gte=20, sort="price", limit=10)
        with Session(self.engine) as session:
            opt = self.options_contract.paginate(session, self.options_contract.Query(**params))  # type: ignore[arg-type]
        with Session(self.engine) as session:
            pol = self.policy_contract.paginate(session, self.policy_contract.Query(**params))  # type: ignore[arg-type]
        self.assertEqual([i.id for i in opt.items], [i.id for i in pol.items])
        self.assertEqual(opt.pagination.total, pol.pagination.total)

    def test_policy_sql_matches_options_pg_dialect(self) -> None:
        params = dict(price_gte=10, price_in=[10, 20], category_isnull=True, q="a%b", sort="-category")
        opt_q = self.options_contract.Query(**params)  # type: ignore[arg-type]
        pol_q = self.policy_contract.Query(**params)  # type: ignore[arg-type]
        opt_sql = str(
            apply_query_schema(stmt=select(Widget), query=opt_q, plan=self.options_contract.plan)
            .compile(dialect=postgresql.dialect())
        )
        pol_sql = str(
            apply_query_schema(stmt=select(Widget), query=pol_q, plan=self.policy_contract.plan)
            .compile(dialect=postgresql.dialect())
        )
        self.assertEqual(opt_sql, pol_sql)


class ResourceQueryFacadeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = _engine_with_data()
        self.resource: ResourceQuery[WidgetRead] = ResourceQuery(
            name="WidgetResource", model=Widget, schema=WidgetRead, options=OPTIONS
        )

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)

    def test_constructor_query_and_paginate_preserved(self) -> None:
        self.assertIs(self.resource.model, Widget)
        self.assertIs(self.resource.schema, WidgetRead)
        self.assertIn("price_in", self.resource.Query.model_fields)
        query = self.resource.Query(sort="price", limit=2)  # type: ignore[arg-type]
        with Session(self.engine) as session:
            page = self.resource.paginate(session, query)
        self.assertEqual([i.price for i in page.items], [10, 20])


class BaseStmtScopeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = _engine_with_data()
        self.contract = _options_contract()

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)

    def test_base_stmt_where_is_respected(self) -> None:
        base = select(Widget).where(Widget.category != "hidden")
        query = self.contract.Query(sort="price", limit=10)  # type: ignore[arg-type]
        with Session(self.engine) as session:
            page = self.contract.paginate(session, query, stmt=base)
        # id=4 (category 'hidden') queda fuera por el scope; id=2 (NULL) también, por
        # lógica trivaluada de SQL (NULL != 'hidden' es NULL).
        self.assertEqual(sorted(i.id for i in page.items), [1, 3])
        self.assertEqual(page.pagination.total, 2)


class ExplicitPlanTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = _engine_with_data()

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)

    def test_paginate_uses_plan_not_dunder_metadata(self) -> None:
        contract = _options_contract()
        # Corromper la metadata heredada del schema: si el contrato dependiera de
        # los __query_*__ en vez del plan, los filtros/orden se romperían.
        contract.Query.__query_columns__ = {}
        contract.Query.__query_all_columns__ = {}
        contract.Query.__query_sort_columns__ = {}
        contract.Query.__query_range_fields__ = set()
        contract.Query.__query_in_fields__ = set()
        contract.Query.__query_null_filter_fields__ = set()
        contract.Query.__query_search_columns__ = ()

        query = contract.Query(price_gte=20, sort="price", limit=10)  # type: ignore[arg-type]
        with Session(self.engine) as session:
            page = contract.paginate(session, query)
        self.assertEqual([i.price for i in page.items], [20, 30, 40])
        self.assertEqual(page.pagination.total, 3)


class ConfigSourceTest(unittest.TestCase):
    def test_both_options_and_policy_raises(self) -> None:
        policy = OPTIONS.to_policy(WidgetRead, Widget)
        with self.assertRaisesRegex(QuerySchemaConfigError, "ambiguous_query_config"):
            ListQueryContract(name="Bad", model=Widget, schema=WidgetRead, options=OPTIONS, policy=policy)

    def test_no_source_defaults_to_empty_options(self) -> None:
        # Sin fuentes: options vacías (solo paginación + desempate por PK).
        empty = ListQueryContract(name="EmptyQuery", model=Widget, schema=WidgetRead)
        self.assertEqual(dict(empty.plan.public_sort_columns), {})


if __name__ == "__main__":
    unittest.main()
