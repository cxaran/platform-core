"""Operadores extendidos de C1: texto (ne/contains/starts_with/ends_with) y fecha de
calendario (on/before/after/between).

Cubre lo exigido por el contrato:
- Escape literal de ``%``, ``_`` y ``\\`` en las coincidencias ILIKE.
- Coincidencia de texto case-insensitive (contains/starts_with/ends_with).
- ``not_equals`` como complemento de equals sobre valores no nulos.
- Límites de día de calendario en la zona horaria de aplicación (TZ explícita,
  DST-safe), no la del host/contenedor/PostgreSQL.
- Allowlist: solo los ``(campo, operador)`` declarados generan parámetro; los demás
  no existen en el schema (no se pueden forjar).
- Errores de configuración por operador incompatible con el tipo del campo.
"""

import os
import unittest
from datetime import date, datetime
from zoneinfo import ZoneInfo

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

from pydantic import BaseModel  # noqa: E402
from sqlalchemy import DateTime, Integer, String, create_engine, select  # noqa: E402
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column  # noqa: E402

from backend.app.core.settings import settings  # noqa: E402
from backend.app.query.calendar import day_start_utc, next_day_start_utc  # noqa: E402
from backend.app.query.compiler import apply_query_schema  # noqa: E402
from backend.app.query.factory import compile_list_query  # noqa: E402
from backend.app.query.operators import Operator  # noqa: E402
from backend.app.query.options import QueryOptions  # noqa: E402
from backend.app.query.validation import (  # noqa: E402
    QueryParameterError,
    QuerySchemaConfigError,
)


class _Base(DeclarativeBase):
    pass


class Thing(_Base):
    __tablename__ = "ext_thing"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class ThingRead(BaseModel):
    id: int
    name: str
    quantity: int
    created_at: datetime


_MONTERREY = "America/Monterrey"  # Zona de la spec (UTC-6 fijo desde 2022).
_MADRID = "Europe/Madrid"  # Zona con DST para verificar manejo de horario de verano.


class CalendarBoundaryUnitTest(unittest.TestCase):
    """Límites de día puros: medianoche de pared en la zona → UTC naive."""

    def test_monterrey_fixed_offset(self) -> None:
        tz = ZoneInfo(_MONTERREY)
        # Monterrey es UTC-6: el inicio del 15 es 06:00 UTC; el del 16, 06:00 UTC.
        self.assertEqual(day_start_utc(date(2026, 6, 15), tz), datetime(2026, 6, 15, 6, 0))
        self.assertEqual(next_day_start_utc(date(2026, 6, 15), tz), datetime(2026, 6, 16, 6, 0))

    def test_madrid_summer_offset(self) -> None:
        tz = ZoneInfo(_MADRID)
        # En verano Madrid es UTC+2: el inicio del 1 de julio es 30-jun 22:00 UTC.
        self.assertEqual(day_start_utc(date(2026, 7, 1), tz), datetime(2026, 6, 30, 22, 0))

    def test_madrid_dst_spring_forward_is_wall_clock(self) -> None:
        tz = ZoneInfo(_MADRID)
        # El cambio a verano 2026 es el 29 de marzo. El inicio del 28 (UTC+1) es
        # 27-mar 23:00 UTC; el del 29 (ya UTC+2) es 28-mar 23:00 UTC. El siguiente día
        # se computa por fecha+1 (medianoche de pared), no sumando 24h.
        self.assertEqual(day_start_utc(date(2026, 3, 28), tz), datetime(2026, 3, 27, 23, 0))
        self.assertEqual(next_day_start_utc(date(2026, 3, 28), tz), datetime(2026, 3, 28, 23, 0))


class _RunnerMixin(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://")
        _Base.metadata.create_all(self.engine)

    def tearDown(self) -> None:
        _Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _seed(self, rows: list[Thing]) -> None:
        with Session(self.engine) as session:
            session.add_all(rows)
            session.commit()

    def _names(self, options: QueryOptions, **params: object) -> set[str]:
        compiled = compile_list_query(
            name="ExtThingQuery",
            resource_schema=ThingRead,
            orm_model=Thing,
            options=options,
        )
        query = compiled.schema(**params)  # type: ignore[arg-type]
        stmt = apply_query_schema(stmt=select(Thing), query=query, plan=compiled.plan)
        with Session(self.engine) as session:
            return {row.name for row in session.scalars(stmt).all()}


class TextOperatorsTest(_RunnerMixin):
    _OPTIONS = QueryOptions(
        filter_fields=("name",),
        field_operators={
            "name": (
                Operator.NE,
                Operator.CONTAINS,
                Operator.STARTS_WITH,
                Operator.ENDS_WITH,
            )
        },
    )

    def setUp(self) -> None:
        super().setUp()
        now = datetime(2026, 1, 1, 0, 0)
        self._seed(
            [
                Thing(id=1, name="Ana", created_at=now),
                Thing(id=2, name="BANANA", created_at=now),
                Thing(id=3, name="Cana", created_at=now),
                Thing(id=4, name="5099", created_at=now),
                Thing(id=5, name="50% off", created_at=now),
                Thing(id=6, name="axb", created_at=now),
                Thing(id=7, name="a_b", created_at=now),
                Thing(id=8, name="c\\d", created_at=now),
            ]
        )

    def test_contains_is_case_insensitive(self) -> None:
        self.assertEqual(self._names(self._OPTIONS, name_contains="ana"), {"Ana", "BANANA", "Cana"})

    def test_starts_with_is_case_insensitive(self) -> None:
        self.assertEqual(self._names(self._OPTIONS, name_startswith="ban"), {"BANANA"})

    def test_ends_with_matches_suffix(self) -> None:
        self.assertEqual(self._names(self._OPTIONS, name_endswith="off"), {"50% off"})

    def test_contains_escapes_percent(self) -> None:
        # '%' literal: no debe actuar como comodín (no incluye "5099").
        self.assertEqual(self._names(self._OPTIONS, name_contains="50%"), {"50% off"})

    def test_contains_escapes_underscore(self) -> None:
        # '_' literal: no debe actuar como comodín de un carácter (no incluye "axb").
        self.assertEqual(self._names(self._OPTIONS, name_contains="a_b"), {"a_b"})

    def test_contains_escapes_backslash(self) -> None:
        self.assertEqual(self._names(self._OPTIONS, name_contains="c\\d"), {"c\\d"})

    def test_not_equals_excludes_only_exact_match(self) -> None:
        # ne es complemento de equals (case-sensitive); excluye solo "Ana".
        result = self._names(self._OPTIONS, name_ne="Ana")
        self.assertNotIn("Ana", result)
        self.assertIn("BANANA", result)
        self.assertEqual(len(result), 7)

    def test_contains_compiles_explicit_escape_clause(self) -> None:
        compiled = compile_list_query(
            name="ExtThingQuery",
            resource_schema=ThingRead,
            orm_model=Thing,
            options=self._OPTIONS,
        )
        query = compiled.schema(name_contains="a%b_c\\d")  # type: ignore[call-arg]
        stmt = apply_query_schema(stmt=select(Thing), query=query, plan=compiled.plan)
        compiled_stmt = stmt.compile()
        self.assertIn("ESCAPE", str(compiled_stmt))
        # El valor se escapa literalmente antes de envolverse en comodines '%...%'.
        self.assertIn("%a\\%b\\_c\\\\d%", compiled_stmt.params.values())


class CalendarOperatorsTest(_RunnerMixin):
    _OPTIONS = QueryOptions(
        filter_fields=("name",),
        field_operators={
            "created_at": (
                Operator.ON,
                Operator.BEFORE,
                Operator.AFTER,
                Operator.BETWEEN,
            )
        },
    )

    def setUp(self) -> None:
        super().setUp()
        # Instantes UTC naive elegidos alrededor de los límites del día 2026-06-15 en
        # Monterrey (inicio 06-15 06:00 UTC; fin 06-16 06:00 UTC).
        self._seed(
            [
                Thing(id=1, name="r1", created_at=datetime(2026, 6, 15, 3, 0)),  # 06-14 local
                Thing(id=2, name="r2", created_at=datetime(2026, 6, 15, 12, 0)),  # 06-15 local
                Thing(id=3, name="r3", created_at=datetime(2026, 6, 16, 5, 59)),  # 06-15 local
                Thing(id=4, name="r4", created_at=datetime(2026, 6, 16, 6, 0)),  # 06-16 local
            ]
        )

    def _run(self, **params: object) -> set[str]:
        with self.assertTimezone():
            return self._names(self._OPTIONS, **params)

    def assertTimezone(self):  # noqa: N802 - helper de contexto
        return _patch_timezone(_MONTERREY)

    def test_on_uses_application_timezone_day_bounds(self) -> None:
        # En Monterrey el día 2026-06-15 contiene r2 y r3, no r1 (madrugada UTC del 15
        # que aún es 14 local) ni r4 (justo el límite siguiente).
        self.assertEqual(self._run(created_at_on=date(2026, 6, 15)), {"r2", "r3"})

    def test_before_is_exclusive_start_of_day(self) -> None:
        self.assertEqual(self._run(created_at_before=date(2026, 6, 15)), {"r1"})

    def test_after_is_next_day_start(self) -> None:
        self.assertEqual(self._run(created_at_after=date(2026, 6, 15)), {"r4"})

    def test_between_is_inclusive_for_user_on_both_ends(self) -> None:
        self.assertEqual(
            self._run(created_at_from=date(2026, 6, 14), created_at_to=date(2026, 6, 15)),
            {"r1", "r2", "r3"},
        )

    def test_between_single_end_degrades_gracefully(self) -> None:
        self.assertEqual(self._run(created_at_from=date(2026, 6, 16)), {"r4"})
        self.assertEqual(self._run(created_at_to=date(2026, 6, 14)), {"r1"})

    def test_between_inverted_range_is_rejected(self) -> None:
        # from > to es casi siempre un error de captura: 422 honesto (invalid_range),
        # no un conjunto vacío silencioso.
        with self.assertRaisesRegex(QueryParameterError, "invalid_range"):
            self._run(created_at_from=date(2026, 6, 16), created_at_to=date(2026, 6, 14))


class AllowlistAndConfigTest(unittest.TestCase):
    def _compile(self, options: QueryOptions):
        return compile_list_query(
            name="ExtThingQuery",
            resource_schema=ThingRead,
            orm_model=Thing,
            options=options,
        )

    def test_only_declared_operators_generate_params(self) -> None:
        compiled = self._compile(
            QueryOptions(
                filter_fields=("name",),
                field_operators={"name": (Operator.CONTAINS,), "created_at": (Operator.BETWEEN,)},
            )
        )
        fields = compiled.schema.model_fields
        self.assertIn("name_contains", fields)
        self.assertIn("created_at_from", fields)
        self.assertIn("created_at_to", fields)
        # Operadores NO declarados no existen como parámetro (no se pueden forjar).
        for forged in ("name_ne", "name_startswith", "created_at_on", "name_in"):
            self.assertNotIn(forged, fields)

    def test_text_operator_on_non_text_field_fails_config(self) -> None:
        with self.assertRaisesRegex(QuerySchemaConfigError, "unsupported_operator_for_type"):
            self._compile(QueryOptions(field_operators={"quantity": (Operator.CONTAINS,)}))

    def test_calendar_operator_on_non_datetime_field_fails_config(self) -> None:
        with self.assertRaisesRegex(QuerySchemaConfigError, "unsupported_operator_for_type"):
            self._compile(QueryOptions(field_operators={"name": (Operator.ON,)}))

    def test_calendar_between_on_non_datetime_field_fails_config(self) -> None:
        with self.assertRaisesRegex(QuerySchemaConfigError, "unsupported_operator_for_type"):
            self._compile(QueryOptions(field_operators={"quantity": (Operator.BETWEEN,)}))


class _patch_timezone:
    """Context manager que fija ``settings.application_timezone`` durante el bloque.

    Los operadores de fecha toman la zona al compilar el plan; el compile ocurre dentro
    del bloque, así que el plan refleja la zona parcheada de forma determinista.
    """

    def __init__(self, tz: str) -> None:
        self._tz = tz
        self._previous = ""

    def __enter__(self) -> "_patch_timezone":
        self._previous = settings.application_timezone
        settings.application_timezone = self._tz
        return self

    def __exit__(self, *exc: object) -> None:
        settings.application_timezone = self._previous


if __name__ == "__main__":
    unittest.main()
