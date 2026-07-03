import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import Field

from backend.app.schemas.base import ApiReadSchema

# La bitácora de auditoría es SÓLO LECTURA: no hay schemas de escritura (Create/Update).
# Los eventos los emite el servidor; el cliente jamás los crea ni los edita.


class AuditEventRead(ApiReadSchema):
    """Representación completa de un evento de auditoría (sólo lectura)."""

    id: uuid.UUID
    entity_type: str
    entity_id: uuid.UUID
    action: str
    actor_user_id: Optional[uuid.UUID] = None
    changed_fields: Optional[dict[str, Any]] = None
    reason: Optional[str] = None
    occurred_at: datetime


class AuditEventListItem(ApiReadSchema):
    """Versión de listado compatible con ``ResourceQuery``.

    Sólo campos factuales de la bitácora. ``changed_fields`` no se proyecta en el
    listado (puede ser voluminoso y contener detalle sensible); se ve en el detalle.
    """

    id: uuid.UUID
    occurred_at: datetime = Field(
        title="Fecha y hora", json_schema_extra={"ui": {"list": True}}
    )
    action: str = Field(title="Acción", json_schema_extra={"ui": {"list": True}})
    entity_type: str = Field(
        title="Tipo de entidad", json_schema_extra={"ui": {"list": True}}
    )
    entity_id: uuid.UUID = Field(title="Entidad")
    actor_user_id: Optional[uuid.UUID] = Field(
        default=None, title="Usuario", json_schema_extra={"ui": {"list": True}}
    )
    reason: Optional[str] = Field(default=None, title="Motivo")
