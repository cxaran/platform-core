import unittest
import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import Enum

from pydantic import BaseModel
from sqlalchemy import Boolean, Date, DateTime, Integer, Numeric, String, create_engine, select
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from backend.app.query import OffsetPage, OffsetPagination, OffsetQuerySchema, QuerySchema, ResourceQuery, paginate
from backend.app.query.compiler import apply_query_schema
from backend.app.query.factory import make_offset_query_schema
from backend.app.query.options import QueryOptions
from backend.app.query.validation import QueryParameterError, QuerySchemaConfigError


class QueryTestBase(DeclarativeBase):
    pass


class PageTestBase(DeclarativeBase):
    pass


class Status(Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class QueryThing(QueryTestBase):
    __tablename__ = "query_thing"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    name: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String)
    is_active: Mapped[bool] = mapped_column(Boolean)
    quantity: Mapped[int] = mapped_column(Integer)
    price: Mapped[Decimal] = mapped_column(Numeric)
    created_on: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    updated_at: Mapped[datetime] = mapped_column(DateTime)


class QueryThingRead(BaseModel):
    id: uuid.UUID
    name: str
    status: Status
    is_active: bool
    quantity: int
    price: Decimal
    created_on: date
    created_at: datetime
    updated_at: datetime


class PageThing(PageTestBase):
    __tablename__ = "page_thing"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime)


class PageThingRead(BaseModel):
    id: int
    name: str
    created_at: datetime


class QuerySchemaTest(unittest.TestCase):
    def test_offset_query_schema_extends_public_query_schema(self) -> None:
        self.assertTrue(issubclass(OffsetQuerySchema, QuerySchema))

    def test_offset_page_exposes_items_and_offset_metadata(self) -> None:
        page = OffsetPage[QueryThingRead](
            items=[],
            pagination=OffsetPagination(
                limit=10,
                offset=20,
                has_next=False,
                total=0,
            ),
        )

        self.assertEqual(page.items, [])
        self.assertEqual(page.pagination.total, 0)
        self.assertEqual(page.pagination.limit, 10)
        self.assertEqual(page.pagination.offset, 20)
        self.assertFalse(page.pagination.has_next)


class QueryHelperFactoryTest(unittest.TestCase):
    def test_factory_generates_query_fields_from_schema(self) -> None:
        query_schema = make_offset_query_schema(
            name="QueryThingListQuery",
            resource_schema=QueryThingRead,
            orm_model=QueryThing,
            options=QueryOptions(
                filter_fields=("id", "name", "status", "is_active", "quantity", "price", "created_on", "created_at"),
                sort_fields=("id", "created_at"),
            ),
        )

        fields = query_schema.model_fields

        self.assertIn("id", fields)
        self.assertIn("name", fields)
        self.assertIn("status", fields)
        self.assertIn("is_active", fields)
        self.assertIn("quantity", fields)
        self.assertIn("quantity_gte", fields)
        self.assertIn("quantity_lte", fields)
        self.assertIn("price_gte", fields)
        self.assertIn("price_lte", fields)
        self.assertIn("created_on_gte", fields)
        self.assertIn("created_on_lte", fields)
        self.assertIn("created_at_gte", fields)
        self.assertIn("created_at_lte", fields)
        self.assertEqual(query_schema().sort, "-created_at")  # pyright: ignore[reportCallIssue]

    def test_factory_does_not_include_orm_columns_absent_from_schema(self) -> None:
        class PublicThingRead(BaseModel):
            id: uuid.UUID
            name: str

        query_schema = make_offset_query_schema(
            name="PublicThingListQuery",
            resource_schema=PublicThingRead,
            orm_model=QueryThing,
            options=QueryOptions(filter_fields=("id", "name")),
        )

        self.assertIn("name", query_schema.model_fields)
        self.assertNotIn("status", query_schema.model_fields)
        self.assertNotIn("is_active", query_schema.model_fields)

    def test_factory_rejects_unsupported_types(self) -> None:
        cases: list[tuple[type[BaseModel], QueryOptions]] = []

        class FloatRead(BaseModel):
            id: uuid.UUID
            score: float

        class ListRead(BaseModel):
            id: uuid.UUID
            tags: list[str]

        class DictRead(BaseModel):
            id: uuid.UUID
            metadata: dict[str, str]

        class NestedValue(BaseModel):
            value: str

        class NestedRead(BaseModel):
            id: uuid.UUID
            nested: NestedValue

        cases.append((FloatRead, QueryOptions(
            filter_fields=("id", "score"),
            column_bindings={"score": QueryThing.quantity},
        )))
        cases.append((ListRead, QueryOptions(
            filter_fields=("id", "tags"),
            column_bindings={"tags": QueryThing.name},
        )))
        cases.append((DictRead, QueryOptions(
            filter_fields=("id", "metadata"),
            column_bindings={"metadata": QueryThing.name},
        )))
        cases.append((NestedRead, QueryOptions(
            filter_fields=("id", "nested"),
            column_bindings={"nested": QueryThing.name},
        )))

        for schema, opts in cases:
            with self.subTest(schema=schema.__name__):
                with self.assertRaisesRegex(QuerySchemaConfigError, "unsupported_schema_field_type"):
                    make_offset_query_schema(
                        name=f"{schema.__name__}Query",
                        resource_schema=schema,
                        orm_model=QueryThing,
                        options=opts,
                    )

    def test_factory_skips_unsupported_field_type_when_not_in_allowlists(self) -> None:
        class ListRead(BaseModel):
            id: uuid.UUID
            tags: list[str]

        query_schema = make_offset_query_schema(
            name="UnsupportedFieldNotInAllowlistsQuery",
            resource_schema=ListRead,
            orm_model=QueryThing,
            options=QueryOptions(filter_fields=("id",)),
        )

        self.assertIn("id", query_schema.model_fields)
        self.assertNotIn("tags", query_schema.model_fields)

    def test_factory_accepts_explicit_column_binding(self) -> None:
        class BoundRead(BaseModel):
            id: uuid.UUID
            display_name: str

        query_schema = make_offset_query_schema(
            name="BoundQuery",
            resource_schema=BoundRead,
            orm_model=QueryThing,
            options=QueryOptions(
                filter_fields=("id", "display_name"),
                column_bindings={"display_name": QueryThing.name},
            ),
        )

        self.assertIn("display_name", query_schema.model_fields)
        self.assertIs(query_schema.__query_columns__["display_name"], QueryThing.name)

    def test_factory_fails_when_schema_field_has_no_column_or_binding(self) -> None:
        class MissingRead(BaseModel):
            id: uuid.UUID
            missing: str

        with self.assertRaisesRegex(QuerySchemaConfigError, "invalid_schema_column_mapping"):
            make_offset_query_schema(
                name="MissingQuery",
                resource_schema=MissingRead,
                orm_model=QueryThing,
                options=QueryOptions(filter_fields=("id", "missing")),
            )

    def test_factory_fails_for_reserved_or_generated_field_names(self) -> None:
        class ReservedRead(BaseModel):
            limit: int

        class SuffixRead(BaseModel):
            price_gte: Decimal

        for schema in (ReservedRead, SuffixRead):
            with self.subTest(schema=schema.__name__):
                with self.assertRaisesRegex(QuerySchemaConfigError, "reserved_query_field_collision"):
                    make_offset_query_schema(
                        name=f"{schema.__name__}Query",
                        resource_schema=schema,
                        orm_model=QueryThing,
                    )

    def test_factory_uses_configured_and_primary_key_sort_defaults(self) -> None:
        class NoCreatedRead(BaseModel):
            id: uuid.UUID
            name: str

        configured = make_offset_query_schema(
            name="ConfiguredSortQuery",
            resource_schema=NoCreatedRead,
            orm_model=QueryThing,
            options=QueryOptions(default_sort="name"),
        )
        fallback = make_offset_query_schema(
            name="FallbackSortQuery",
            resource_schema=NoCreatedRead,
            orm_model=QueryThing,
        )

        self.assertEqual(configured().sort, "name")  # pyright: ignore[reportCallIssue]
        self.assertEqual(fallback().sort, "id")  # pyright: ignore[reportCallIssue]

    def test_factory_rejects_invalid_configured_default_sort(self) -> None:
        class PublicThingRead(BaseModel):
            id: uuid.UUID
            name: str

        error_cases: list[tuple[str, str]] = [
            # Campo inexistente en el contrato público: error de CONFIGURACIÓN del
            # sort (la causa raíz), no un fallo de mapeo de columna.
            ("missing", "invalid_default_sort"),
            ("name,name", "invalid_default_sort"),
            ("name,,id", "invalid_default_sort"),
            ("-", "invalid_default_sort"),
        ]
        for default_sort, expected_error in error_cases:
            with self.subTest(default_sort=default_sort):
                with self.assertRaisesRegex(QuerySchemaConfigError, expected_error):
                    make_offset_query_schema(
                        name="InvalidDefaultSortQuery",
                        resource_schema=PublicThingRead,
                        orm_model=QueryThing,
                        options=QueryOptions(default_sort=default_sort),
                    )

    def test_default_sort_derives_from_pk_even_when_pk_is_not_public(self) -> None:
        # La PK vive en el conjunto orderable interno aunque no esté en el schema
        # público: el default del servidor deriva de ella y el orden es estable,
        # sin exigir configurar default_sort.
        class NoStableDefaultRead(BaseModel):
            name: str

        query_schema = make_offset_query_schema(
            name="NoStableDefaultQuery",
            resource_schema=NoStableDefaultRead,
            orm_model=QueryThing,
        )
        self.assertEqual(query_schema.model_fields["sort"].default, "id")

    def test_factory_generates_in_and_isnull_filters(self) -> None:
        query_schema = make_offset_query_schema(
            name="ExtraFiltersQuery",
            resource_schema=QueryThingRead,
            orm_model=QueryThing,
            options=QueryOptions(in_fields=("status",), null_filter_fields=("updated_at",)),
        )

        self.assertIn("status_in", query_schema.model_fields)
        self.assertIn("updated_at_isnull", query_schema.model_fields)

    def test_factory_rejects_unknown_extra_filter_fields(self) -> None:
        options_by_filter = (
            QueryOptions(in_fields=("missing",)),
            QueryOptions(null_filter_fields=("missing",)),
        )

        for options in options_by_filter:
            with self.subTest(options=options):
                with self.assertRaisesRegex(QuerySchemaConfigError, "invalid_schema_column_mapping"):
                    make_offset_query_schema(
                        name="InvalidExtraFilterQuery",
                        resource_schema=QueryThingRead,
                        orm_model=QueryThing,
                        options=options,
                    )


class QueryHelperCompilerTest(unittest.TestCase):
    def _query_schema(self, *, search: bool = False) -> type:
        return make_offset_query_schema(
            name="CompilerThingListQuery",
            resource_schema=QueryThingRead,
            orm_model=QueryThing,
            options=QueryOptions(
                filter_fields=("name", "is_active", "quantity", "price", "created_on", "status", "id"),
                sort_fields=("name", "created_at", "updated_at", "id"),
                search_fields=("name",) if search else (),
            ),
        )

    def _sql(self, stmt) -> str:
        return str(stmt)

    def test_compiler_applies_equality_and_preserves_base_filters(self) -> None:
        query_schema = self._query_schema()
        query = query_schema(name="admin", is_active=True)
        stmt = apply_query_schema(
            stmt=select(QueryThing).where(QueryThing.id.is_not(None)),
            query=query,
        )
        sql = self._sql(stmt)

        self.assertIn("query_thing.id IS NOT NULL", sql)
        self.assertIn("query_thing.name =", sql)
        self.assertIn("query_thing.is_active IS true", sql)

    def test_compiler_applies_gte_and_lte(self) -> None:
        query_schema = self._query_schema()
        query = query_schema(quantity_gte=10, quantity_lte=20)
        stmt = apply_query_schema(stmt=select(QueryThing), query=query)
        sql = self._sql(stmt)

        self.assertIn("query_thing.quantity >=", sql)
        self.assertIn("query_thing.quantity <=", sql)

    def test_compiler_applies_ascending_sort_and_tie_breaker(self) -> None:
        query_schema = self._query_schema()
        stmt = apply_query_schema(stmt=select(QueryThing), query=query_schema(sort="name"))
        sql = self._sql(stmt)

        self.assertIn("ORDER BY query_thing.name ASC NULLS LAST, query_thing.id ASC", sql)

    def test_compiler_applies_descending_sort_and_tie_breaker(self) -> None:
        query_schema = self._query_schema()
        stmt = apply_query_schema(stmt=select(QueryThing), query=query_schema(sort="-updated_at"))
        sql = self._sql(stmt)

        self.assertIn("ORDER BY query_thing.updated_at DESC NULLS LAST, query_thing.id DESC", sql)

    def test_compiler_applies_multiple_sort_fields(self) -> None:
        query_schema = self._query_schema()
        stmt = apply_query_schema(stmt=select(QueryThing), query=query_schema(sort="-created_at,name"))
        sql = self._sql(stmt)

        self.assertIn(
            "ORDER BY query_thing.created_at DESC NULLS LAST, query_thing.name ASC NULLS LAST, query_thing.id ASC",
            sql,
        )

    def test_compiler_rejects_invalid_sort(self) -> None:
        query_schema = self._query_schema()

        for sort in ("missing", "name,name", "name,,id", "-"):
            with self.subTest(sort=sort):
                with self.assertRaises(QueryParameterError):
                    apply_query_schema(stmt=select(QueryThing), query=query_schema(sort=sort))

    def test_compiler_applies_search_only_when_configured(self) -> None:
        search_schema = self._query_schema(search=True)
        no_search_schema = self._query_schema(search=False)

        self.assertIn("q", search_schema.model_fields)
        self.assertNotIn("q", no_search_schema.model_fields)

        stmt = apply_query_schema(stmt=select(QueryThing), query=search_schema(q="admin"))
        self.assertIn("LIKE", self._sql(stmt))

    def test_compiler_escapes_like_search_value(self) -> None:
        query_schema = self._query_schema(search=True)
        stmt = apply_query_schema(stmt=select(QueryThing), query=query_schema(q="a%b_c\\d"))
        params = stmt.compile().params

        self.assertIn("%a\\%b\\_c\\\\d%", params.values())


    def test_compiler_applies_in_filter(self) -> None:
        query_schema = make_offset_query_schema(
            name="CompilerInQuery",
            resource_schema=QueryThingRead,
            orm_model=QueryThing,
            options=QueryOptions(in_fields=("name",)),
        )

        stmt = apply_query_schema(stmt=select(QueryThing), query=query_schema(name_in=["admin", "owner"]))  # pyright: ignore[reportCallIssue, reportArgumentType]
        self.assertIn("query_thing.name IN", self._sql(stmt))

    def test_compiler_applies_isnull_filters(self) -> None:
        query_schema = make_offset_query_schema(
            name="CompilerNullQuery",
            resource_schema=QueryThingRead,
            orm_model=QueryThing,
            options=QueryOptions(null_filter_fields=("updated_at",)),
        )

        null_stmt = apply_query_schema(stmt=select(QueryThing), query=query_schema(updated_at_isnull=True))  # pyright: ignore[reportCallIssue, reportArgumentType]
        not_null_stmt = apply_query_schema(stmt=select(QueryThing), query=query_schema(updated_at_isnull=False))  # pyright: ignore[reportCallIssue, reportArgumentType]

        self.assertIn("query_thing.updated_at IS NULL", self._sql(null_stmt))
        self.assertIn("query_thing.updated_at IS NOT NULL", self._sql(not_null_stmt))


class QueryExecutorTest(unittest.TestCase):
    def _session(self) -> Session:
        engine = create_engine("sqlite+pysqlite:///:memory:")
        PageTestBase.metadata.create_all(engine)
        session = Session(engine)
        self.addCleanup(engine.dispose)
        self.addCleanup(session.close)
        return session

    def _seed(self, session: Session) -> None:
        session.add_all(
            [
                PageThing(id=1, name="admin", created_at=datetime(2024, 1, 1)),
                PageThing(id=2, name="owner", created_at=datetime(2024, 1, 2)),
                PageThing(id=3, name="guest", created_at=datetime(2024, 1, 3)),
            ]
        )
        session.commit()

    def test_paginate_returns_items_and_pagination_metadata(self) -> None:
        session = self._session()
        self._seed(session)
        query_schema = make_offset_query_schema(
            name="PageThingQuery",
            resource_schema=PageThingRead,
            orm_model=PageThing,
            # La PK ya no es ordenable pública por defecto: se declara.
            options=QueryOptions(sort_fields=("id",)),
        )

        page = paginate(
            session,
            stmt=select(PageThing),
            query=query_schema(limit=2, offset=0, sort="id"),
            item_schema=PageThingRead,
        )

        self.assertEqual([item.id for item in page.items], [1, 2])
        self.assertEqual(page.pagination.total, 3)
        self.assertEqual(page.pagination.limit, 2)
        self.assertEqual(page.pagination.offset, 0)
        self.assertTrue(page.pagination.has_next)

    def test_resource_query_paginates_custom_statement(self) -> None:
        session = self._session()
        self._seed(session)
        resource = ResourceQuery(name="PageThingResourceQuery", model=PageThing, schema=PageThingRead)

        page = resource.paginate(
            session,
            resource.Query(limit=10, sort="id"),
            stmt=select(PageThing).where(PageThing.name != "guest"),
        )

        self.assertEqual([item.name for item in page.items], ["admin", "owner"])
        self.assertEqual(page.pagination.total, 2)
        self.assertFalse(page.pagination.has_next)


if __name__ == "__main__":
    unittest.main()
