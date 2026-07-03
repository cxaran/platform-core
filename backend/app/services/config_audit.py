"""Auditoría de cambios de CONFIGURACIÓN sobre la bitácora existente (AuditEvent).

Regla de seguridad por construcción: ``changed_fields`` lleva SOLO los NOMBRES de los
campos modificados (lista de strings), jamás valores — así un secreto no puede
filtrarse a la bitácora ni por accidente. El detalle de "qué valor quedó" se consulta
en la propia configuración (que tampoco proyecta secretos).
"""

import uuid
from typing import Optional, Sequence

from sqlmodel import Session

from backend.app.models.audit_event import AuditEvent


def record_config_change(
    session: Session,
    *,
    actor_user_id: Optional[uuid.UUID],
    entity_type: str,
    entity_id: uuid.UUID,
    action: str,
    changed_fields: Sequence[str],
) -> None:
    """Registra un cambio de configuración (append-only, sin valores)."""
    session.add(
        AuditEvent(
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            actor_user_id=actor_user_id,
            changed_fields={"fields": sorted(set(changed_fields))},
        )
    )
