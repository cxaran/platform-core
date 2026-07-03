"""Bitácora de auditoría (sólo lectura) bajo ``audit_events:read``.

Expone los eventos de auditoría YA registrados (append-only): quién ejecutó qué acción, sobre
qué entidad y cuándo. NO crea, edita ni elimina eventos; sólo los consulta. Los filtros (por
actor, acción, tipo de entidad, entidad y rango de fecha) y el orden los resuelve el
``ResourceQuery``. Nunca infiere intención más allá de lo registrado.

El rastro de un registro concreto se consulta por ``entity_type``/``entity_id``
(p. ej. ``entity_type=system_settings&entity_id=<id>``).
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query
from sqlmodel import select

from backend.app.api.resource_actions import get_or_404, paginate_resource, serialize
from backend.app.core.database import SessionDep
from backend.app.models.audit_event import AuditEvent
from backend.app.resources.registry import AUDIT_EVENTS
from backend.app.schemas.audit_event import AuditEventListItem, AuditEventRead
from backend.app.schemas.pagination import OffsetPage
from backend.app.security.groups.audit_events import AuditEventPermissions

router = APIRouter(prefix="/audit-events", tags=["audit-events"])

_NOT_FOUND = "Evento de auditoría no encontrado"


@router.get("", response_model=OffsetPage[AuditEventListItem])
def list_audit_events(
    session: SessionDep,
    query: Annotated[AUDIT_EVENTS.Query, Query()],  # pyright: ignore[reportInvalidTypeForm]
    _: AuditEventPermissions.READ.requiere,
) -> OffsetPage[AuditEventListItem]:
    # La bitácora es append-only (sin baja lógica): el scope base son todos los eventos.
    # Los filtros (actor/acción/tipo de entidad/entidad/rango de fecha) y el orden por fecha
    # descendente los aplica el ResourceQuery. Consulta pura: no muta nada.
    stmt = select(AuditEvent)
    return paginate_resource(AUDIT_EVENTS, session, query, stmt=stmt)


@router.get("/{event_id}", response_model=AuditEventRead)
def get_audit_event(
    event_id: UUID,
    session: SessionDep,
    _: AuditEventPermissions.READ.requiere,
) -> AuditEventRead:
    return serialize(AuditEventRead, get_or_404(session, AuditEvent, event_id, _NOT_FOUND))
