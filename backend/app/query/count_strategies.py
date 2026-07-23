"""``CountStrategy``: cómo se calcula ``total``.

Todas reciben el statement YA filtrado (sin ORDER BY/OFFSET/LIMIT). ``NoTotalCount`` es
el modo sin total: no ejecuta ``COUNT(*)`` y el executor resuelve ``has_next`` por
sobre-lectura (pide una fila de más). Es para feeds grandes (p. ej. la bitácora
append-only) donde contar en cada página es caro y el total exacto no aporta.
"""

from typing import Any, Callable, Protocol

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from backend.app.query.plans import CompiledQueryPlan


class CountStrategy(Protocol):
    def count(self, session: Session, filtered: Select[Any], plan: CompiledQueryPlan) -> int: ...


class NoTotalCount:
    """Modo sin total: no cuenta. El executor lo detecta y pagina por sobre-lectura
    (``limit + 1``), dejando ``total`` en ``None`` y ``has_next`` derivado del exceso.

    ``count`` existe solo para satisfacer el ``Protocol``; nunca se invoca (el executor
    ramifica antes con ``isinstance``). Devuelve ``0`` de forma inocua si se llamara."""

    def count(self, session: Session, filtered: Select[Any], plan: CompiledQueryPlan) -> int:
        return 0


class AutomaticCount:
    """Default: ``COUNT(*)`` sobre la subconsulta filtrada (sin order_by).

    Coherente con ``items`` para ``select(Model)`` 1:1.
    """

    def count(self, session: Session, filtered: Select[Any], plan: CompiledQueryPlan) -> int:
        stmt = select(func.count()).select_from(filtered.order_by(None).subquery())
        return session.scalar(stmt) or 0


class DistinctIdentityCount:
    """Cuenta entidades únicas: ``COUNT(*)`` sobre ``SELECT DISTINCT <identidad>``.

    Para joins 1:N que duplican filas. Usa todas las expresiones de
    ``plan.identity`` (válido para PK compuesta), no un ``COUNT(DISTINCT pk)``
    simplificado.
    """

    def count(self, session: Session, filtered: Select[Any], plan: CompiledQueryPlan) -> int:
        subquery = (
            filtered.order_by(None)
            .with_only_columns(*plan.identity.columns)
            .distinct()
            .subquery()
        )
        stmt = select(func.count()).select_from(subquery)
        return session.scalar(stmt) or 0


class CustomCountStatement:
    """Conteo provisto por el contrato. ``build_count`` recibe el statement ya
    filtrado (sin order_by) y devuelve un ``Select`` escalar de conteo."""

    def __init__(self, build_count: Callable[[Select[Any]], Select[Any]]) -> None:
        self._build_count = build_count

    def count(self, session: Session, filtered: Select[Any], plan: CompiledQueryPlan) -> int:
        return session.scalar(self._build_count(filtered.order_by(None))) or 0
