"""Fase 2 — Paso 1: FieldSpec, QueryPolicy, operadores y adaptador to_policy.

La prueba central es de EQUIVALENCIA: QueryOptions actual -> to_policy(...) produce
una policy cuyo conjunto de parámetros derivado coincide exactamente con los
model_fields del XQuery que genera el factory hoy, con los mismos tipos y fuentes.
El factory/compiler/executor no se modifican en este paso.
"""

import unittest

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Integer, String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from backend.app.query import (
    Operator,
    QueryOptions,
    QueryPolicy,
    make_offset_query_schema,
    paginate,
)
from backend.app.query.operators import (
    RANGE,
    default_operators,
    normalize_operators,
    param_names_for,
)
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


_OPTIONS = QueryOptions(
    filter_fields=("name", "price", "category"),
    sort_fields=("id", "name", "price", "category"),
    search_fields=("name",),
    in_fields=("price",),
    null_filter_fields=("category",),
    default_sort="-price",
)

WidgetQuery = make_offset_query_schema(
    name="WidgetQuery",
    resource_schema=WidgetRead,
    orm_model=Widget,
    options=_OPTIONS,
)


class OperatorsUnitTest(unittest.TestCase):
    def test_range_normalizes_to_gte_lte(self) -> None:
        self.assertEqual(normalize_operators([RANGE]), frozenset({Operator.GTE, Operator.LTE}))

    def test_normalize_mixes_real_ops_and_range(self) -> None:
        self.assertEqual(
            normalize_operators([Operator.EQ, RANGE]),
            frozenset({Operator.EQ, Operator.GTE, Operator.LTE}),
        )

    def test_normalize_rejects_unknown_operator(self) -> None:
        with self.assertRaises(ValueError):
            normalize_operators(["definitely_not_an_operator"])

    def test_default_operators_by_type(self) -> None:
        self.assertEqual(default_operators(str), frozenset({Operator.EQ}))
        self.assertEqual(default_operators(int), frozenset({Operator.EQ, Operator.GTE, Operator.LTE}))

    def test_param_names_for(self) -> None:
        params = param_names_for("price", frozenset({Operator.EQ, Operator.GTE, Operator.LTE, Operator.IN}))
        self.assertEqual(params, {"price", "price_gte", "price_lte", "price_in"})

    def test_searchable_generates_no_field_param(self) -> None:
        # 'search' no es operador: un campo solo-searchable no aporta parámetro propio.
        self.assertEqual(param_names_for("name", frozenset()), set())


class EquivalenceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.policy = _OPTIONS.to_policy(WidgetRead, Widget)

    def test_to_policy_returns_query_policy(self) -> None:
        self.assertIsInstance(self.policy, QueryPolicy)

    def test_param_names_match_generated_xquery(self) -> None:
        self.assertEqual(self.policy.param_names, set(WidgetQuery.model_fields))

    def test_field_operators_match_options(self) -> None:
        name = self.policy.field("name")
        price = self.policy.field("price")
        category = self.policy.field("category")
        assert name and price and category

        self.assertEqual(name.operators, frozenset({Operator.EQ}))
        self.assertTrue(name.searchable)
        self.assertEqual(price.operators, frozenset({Operator.EQ, Operator.GTE, Operator.LTE, Operator.IN}))
        self.assertEqual(category.operators, frozenset({Operator.EQ, Operator.ISNULL}))

    def test_sort_only_field_has_no_operators(self) -> None:
        id_spec = self.policy.field("id")
        assert id_spec
        self.assertEqual(id_spec.operators, frozenset())
        self.assertFalse(id_spec.searchable)
        self.assertEqual(id_spec.param_names, set())

    def test_field_types_match(self) -> None:
        self.assertIs(self.policy.field("price").type, int)  # type: ignore[union-attr]
        self.assertIs(self.policy.field("category").type, str)  # Optional desenvuelto  # type: ignore[union-attr]

    def test_field_source_is_orm_column(self) -> None:
        self.assertIs(self.policy.field("name").source, Widget.name)  # type: ignore[union-attr]

    def test_sort_and_limits_captured(self) -> None:
        self.assertEqual(self.policy.sort.public_sort_fields, _OPTIONS.sort_fields)
        self.assertEqual(self.policy.sort.default_order, "-price")
        self.assertEqual(self.policy.pagination.max_limit, _OPTIONS.max_limit)
        self.assertEqual(self.policy.limits.max_in_values, _OPTIONS.max_in_values)
        self.assertEqual(self.policy.search.min_len, 2)


class ColumnBindingTest(unittest.TestCase):
    def test_binding_is_captured_as_source(self) -> None:
        class BoundRead(BaseModel):
            id: int
            display_name: str

        options = QueryOptions(
            filter_fields=("display_name",),
            sort_fields=("id",),
            column_bindings={"display_name": Widget.name},
        )
        policy = options.to_policy(BoundRead, Widget)
        self.assertIs(policy.field("display_name").source, Widget.name)  # type: ignore[union-attr]


class ToPolicyValidationTest(unittest.TestCase):
    def test_requested_field_absent_from_schema_raises(self) -> None:
        options = QueryOptions(filter_fields=("missing",), sort_fields=("id",))
        with self.assertRaises(QuerySchemaConfigError):
            options.to_policy(WidgetRead, Widget)

    def test_reserved_field_name_raises(self) -> None:
        class ReservedRead(BaseModel):
            id: int
            limit: int

        options = QueryOptions(filter_fields=("id",), sort_fields=("id",))
        with self.assertRaises(QuerySchemaConfigError):
            options.to_policy(ReservedRead, Widget)


class ObservableBehaviourTest(unittest.TestCase):
    """El comportamiento SQL no cambia (factory/compiler intactos); se verifica que
    una consulta representativa sigue ejecutándose con los mismos resultados."""

    def setUp(self) -> None:
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as session:
            session.add_all(
                [
                    Widget(id=1, name="alpha", price=10, category="tools"),
                    Widget(id=2, name="beta", price=30, category=None),
                    Widget(id=3, name="gamma", price=50, category="tools"),
                ]
            )
            session.commit()

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)

    def test_query_still_runs_with_same_params(self) -> None:
        query = WidgetQuery(price_gte=20, sort="price")  # type: ignore[arg-type]
        with Session(self.engine) as session:
            page = paginate(session, stmt=select(Widget), query=query, item_schema=WidgetRead)
        self.assertEqual([item.price for item in page.items], [30, 50])
        self.assertEqual(page.pagination.total, 2)


if __name__ == "__main__":
    unittest.main()
