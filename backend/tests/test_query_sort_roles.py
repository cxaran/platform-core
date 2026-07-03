"""Fase 2 — Paso 4: tres roles de orden (public/orderable/tie_breakers).

Cubre la diferencia legacy (options: PK solicitable) vs nativo (policy: PK interna),
que default_order puede usar campos orderable no públicos, el desempate por clave
lógica (sin duplicar la PK), y que la policy reemplaza cualquier ORDER BY del stmt
base.
"""

import unittest

from pydantic import BaseModel, ConfigDict
from sqlalchemy import Integer, String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from backend.app.query import ListQueryContract, QueryOptions
from backend.app.query.compiler import apply_query_schema
from backend.app.query.validation import QueryParameterError


class Base(DeclarativeBase):
    pass


class Widget(Base):
    __tablename__ = "widget"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    price: Mapped[int] = mapped_column(Integer, nullable=False)


class WidgetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    price: int


def _sql(stmt: object) -> str:
    return str(stmt.compile())  # type: ignore[attr-defined]


def _order_by(sql: str) -> str:
    return sql.upper().split("ORDER BY", 1)[1] if "ORDER BY" in sql.upper() else ""


class LegacyVsNativePkTest(unittest.TestCase):
    """Misma config de fields; la PK no está en sort_fields. Ambos caminos la
    tratan como INTERNA (tie-breaker): ya no es solicitable sin declararla."""

    OPTIONS = QueryOptions(filter_fields=("name",), sort_fields=("name",), default_sort="name")

    def test_legacy_options_treats_pk_as_internal(self) -> None:
        contract = ListQueryContract(
            name="LegacyPk", model=Widget, schema=WidgetRead, options=self.OPTIONS
        )
        # id no está en sort_fields: el camino legacy YA NO lo publica (deuda 2).
        with self.assertRaises(QueryParameterError):
            apply_query_schema(
                stmt=select(Widget), query=contract.Query(sort="id"), plan=contract.plan  # type: ignore[arg-type]
            )
        # ...pero sigue presente como tie-breaker al ordenar por un campo público.
        stmt = apply_query_schema(
            stmt=select(Widget), query=contract.Query(sort="name"), plan=contract.plan  # type: ignore[arg-type]
        )
        self.assertIn("WIDGET.ID", _order_by(_sql(stmt)))

    def test_legacy_options_allows_pk_sort_when_declared(self) -> None:
        contract = ListQueryContract(
            name="LegacyPkDeclared",
            model=Widget,
            schema=WidgetRead,
            options=QueryOptions(
                filter_fields=("name",), sort_fields=("name", "id"), default_sort="name"
            ),
        )
        stmt = apply_query_schema(
            stmt=select(Widget), query=contract.Query(sort="id"), plan=contract.plan  # type: ignore[arg-type]
        )
        self.assertIn("WIDGET.ID", _order_by(_sql(stmt)))

    def test_native_policy_treats_pk_as_internal(self) -> None:
        policy = self.OPTIONS.to_policy(WidgetRead, Widget)
        contract = ListQueryContract(name="NativePk", model=Widget, schema=WidgetRead, policy=policy)
        # sort=id es rechazado (la PK no es pública en el camino nativo)...
        with self.assertRaises(QueryParameterError):
            apply_query_schema(
                stmt=select(Widget), query=contract.Query(sort="id"), plan=contract.plan  # type: ignore[arg-type]
            )
        # ...pero sigue presente como tie-breaker al ordenar por un campo público.
        stmt = apply_query_schema(
            stmt=select(Widget), query=contract.Query(sort="name"), plan=contract.plan  # type: ignore[arg-type]
        )
        self.assertIn("WIDGET.ID", _order_by(_sql(stmt)))


class SortFieldsTriStateTest(unittest.TestCase):
    """Tri-estado de ``QueryOptions.sort_fields`` (deuda 1 de QUERY_DESIGN_DEBT.md):
    None deriva de los consultables; () es estricto; una tupla es la allowlist."""

    def test_none_derives_public_sort_from_queryable_fields(self) -> None:
        contract = ListQueryContract(
            name="TriNone",
            model=Widget,
            schema=WidgetRead,
            options=QueryOptions(filter_fields=("name", "price"), default_sort="name"),
        )
        self.assertEqual(set(contract.plan.public_sort_columns), {"name", "price"})
        stmt = apply_query_schema(
            stmt=select(Widget), query=contract.Query(sort="price"), plan=contract.plan  # type: ignore[arg-type]
        )
        self.assertIn("WIDGET.PRICE", _order_by(_sql(stmt)))

    def test_empty_tuple_is_strict_mode_without_public_sort(self) -> None:
        contract = ListQueryContract(
            name="TriStrict",
            model=Widget,
            schema=WidgetRead,
            options=QueryOptions(filter_fields=("name",), sort_fields=(), default_sort="name"),
        )
        self.assertEqual(dict(contract.plan.public_sort_columns), {})
        # Cualquier sort del cliente DISTINTO del default del servidor se rechaza
        # (enviar exactamente el default es indistinguible de no enviar sort).
        with self.assertRaises(QueryParameterError):
            apply_query_schema(
                stmt=select(Widget), query=contract.Query(sort="-name"), plan=contract.plan  # type: ignore[arg-type]
            )
        # ...pero el default del servidor sigue aplicando, con desempate por PK.
        stmt = apply_query_schema(
            stmt=select(Widget), query=contract.Query(), plan=contract.plan  # type: ignore[arg-type]
        )
        order_by = _order_by(_sql(stmt))
        self.assertIn("WIDGET.NAME", order_by)
        self.assertIn("WIDGET.ID", order_by)

    def test_explicit_tuple_is_exact_allowlist(self) -> None:
        contract = ListQueryContract(
            name="TriAllow",
            model=Widget,
            schema=WidgetRead,
            options=QueryOptions(
                filter_fields=("name", "price"), sort_fields=("name",), default_sort="name"
            ),
        )
        self.assertEqual(set(contract.plan.public_sort_columns), {"name"})
        with self.assertRaises(QueryParameterError):
            apply_query_schema(
                stmt=select(Widget), query=contract.Query(sort="price"), plan=contract.plan  # type: ignore[arg-type]
            )

    def test_public_string_params_strip_surrounding_whitespace(self) -> None:
        # Política confirmada (deuda 4): el espacio periférico es ruido del cliente
        # en TODOS los parámetros string públicos (sort, q y filtros de texto).
        contract = ListQueryContract(
            name="TriStrip",
            model=Widget,
            schema=WidgetRead,
            options=QueryOptions(
                filter_fields=("name",),
                search_fields=("name",),
                sort_fields=("name",),
                default_sort="name",
            ),
        )
        query = contract.Query(sort=" -name ", q="  admin  ", name=" Ana ")  # type: ignore[call-arg]
        self.assertEqual(query.sort, "-name")
        self.assertEqual(query.q, "admin")  # type: ignore[attr-defined]
        self.assertEqual(query.name, "Ana")  # type: ignore[attr-defined]
        stmt = apply_query_schema(stmt=select(Widget), query=query, plan=contract.plan)
        self.assertIn("WIDGET.NAME DESC", _order_by(_sql(stmt)))


class OrderableDefaultTest(unittest.TestCase):
    """default_order puede usar un campo orderable que NO es públicamente
    solicitable."""

    def setUp(self) -> None:
        # price es filtrable (orderable) pero no está en sort_fields (no público).
        options = QueryOptions(
            filter_fields=("name", "price"), sort_fields=("name",), default_sort="-price"
        )
        policy = options.to_policy(WidgetRead, Widget)
        self.contract = ListQueryContract(
            name="OrderableDefault", model=Widget, schema=WidgetRead, policy=policy
        )

    def test_default_order_uses_non_public_orderable_field(self) -> None:
        self.assertEqual(self.contract.Query().sort, "-price")  # type: ignore[call-arg]
        stmt = apply_query_schema(
            stmt=select(Widget), query=self.contract.Query(sort="-price"), plan=self.contract.plan  # type: ignore[arg-type]
        )
        self.assertIn("WIDGET.PRICE DESC", _order_by(_sql(stmt)))

    def test_client_cannot_sort_by_non_public_field(self) -> None:
        with self.assertRaises(QueryParameterError):
            apply_query_schema(
                stmt=select(Widget), query=self.contract.Query(sort="price"), plan=self.contract.plan  # type: ignore[arg-type]
            )


class TieBreakerDedupTest(unittest.TestCase):
    def test_pk_not_duplicated_when_requested(self) -> None:
        options = QueryOptions(sort_fields=("id", "name"), default_sort="name")
        contract = ListQueryContract(name="Dedup", model=Widget, schema=WidgetRead, options=options)
        stmt = apply_query_schema(
            stmt=select(Widget), query=contract.Query(sort="id"), plan=contract.plan  # type: ignore[arg-type]
        )
        # id pedido explícitamente → no se añade otra vez como tie-breaker.
        self.assertEqual(_order_by(_sql(stmt)).count("WIDGET.ID"), 1)


class OrderByReplacementTest(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as session:
            session.add_all(
                [
                    Widget(id=1, name="b", price=30),
                    Widget(id=2, name="a", price=10),
                    Widget(id=3, name="c", price=20),
                ]
            )
            session.commit()

    def tearDown(self) -> None:
        Base.metadata.drop_all(self.engine)

    def test_policy_replaces_base_stmt_order_by(self) -> None:
        options = QueryOptions(filter_fields=("name", "price"), sort_fields=("price",), default_sort="price")
        contract = ListQueryContract(name="Replace", model=Widget, schema=WidgetRead, options=options)
        base = select(Widget).order_by(Widget.name.desc())  # orden propio del stmt base
        stmt = apply_query_schema(
            stmt=base, query=contract.Query(sort="price"), plan=contract.plan  # type: ignore[arg-type]
        )
        order = _order_by(_sql(stmt))
        self.assertIn("WIDGET.PRICE", order)
        self.assertNotIn("WIDGET.NAME", order)  # el ORDER BY del base fue reemplazado

    def test_replacement_yields_price_order_at_runtime(self) -> None:
        options = QueryOptions(filter_fields=("price",), sort_fields=("price",), default_sort="price")
        contract = ListQueryContract(name="Replace2", model=Widget, schema=WidgetRead, options=options)
        base = select(Widget).order_by(Widget.name.desc())
        with Session(self.engine) as session:
            page = contract.paginate(session, contract.Query(sort="price"), stmt=base)  # type: ignore[arg-type]
        self.assertEqual([w.price for w in page.items], [10, 20, 30])


if __name__ == "__main__":
    unittest.main()
