"""Notificaciones: campana propia (/me), Web Push y difusión del administrador.

Las propias son recurso PROPIO: cualquier usuario autenticado lee y marca las
suyas — jamás las de otro. Las suscripciones push también: cada navegador
registra/da de baja SU endpoint bajo la sesión activa. La difusión exige
``notifications:send`` y queda auditada con NOMBRES de campos (nunca el
contenido).
"""

import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Header, Query, status
from pydantic import Field, field_validator
from sqlmodel import select

from backend.app.api.resource_actions import api_error, commit_or_conflict
from backend.app.auth.auth_dependencies import CurrentUser
from backend.app.core.database import SessionDep
from backend.app.models.notification import Notification
from backend.app.schemas.base import ApiReadSchema, ApiWriteSchema
from backend.app.security.groups.notifications import NotificationPermissions
from backend.app.services.config_audit import record_config_change
from backend.app.services.notification_service import (
    broadcast,
    kick_notification_dispatch,
    mark_all_read,
    notification_href,
    unread_count,
)
from backend.app.utils.utc_now import utc_now

router = APIRouter(prefix="/notifications", tags=["notifications"])

_BROADCAST_AUDIT_ID = uuid.UUID("00000000-0000-4000-a000-5706ef2e7003")


class NotificationRead(ApiReadSchema):
    id: uuid.UUID
    kind: str
    title: str
    body: str
    # Destino al tocar la notificación (link_url de la fila o derivado del tipo);
    # None = sin destino. La campana lo usa para enlazar el ítem.
    href: Optional[str] = None
    read_at: Optional[str] = None
    created_at: str


class MyNotifications(ApiReadSchema):
    unread_count: int
    items: list[NotificationRead] = Field(default_factory=list)


def _read(row: Notification) -> NotificationRead:
    return NotificationRead(
        id=row.id,
        kind=row.kind,
        title=row.title,
        body=row.body,
        href=notification_href(row.kind, row.link_url),
        read_at=row.read_at.isoformat() if row.read_at else None,
        created_at=row.created_at.isoformat() if row.created_at else utc_now().isoformat(),
    )


@router.get("/me", response_model=MyNotifications)
def my_notifications(
    session: SessionDep,
    current_user: CurrentUser,
    limit: int = Query(default=30, ge=1, le=100),
    unread_only: bool = Query(default=False),
) -> MyNotifications:
    # La campana pide unread_only=true: descartar (marcar leída) una notificación
    # la saca de la lista, así el panel no crece sin límite. El histórico completo
    # sigue en la base (cola de correo/push); simplemente no se muestra.
    stmt = select(Notification).where(Notification.user_id == current_user.id)
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))  # pyright: ignore[reportAttributeAccessIssue]
    rows = session.exec(
        stmt.order_by(Notification.created_at.desc())  # pyright: ignore[reportAttributeAccessIssue]
        .limit(limit)
    ).all()
    return MyNotifications(
        unread_count=unread_count(session, current_user.id),
        items=[_read(row) for row in rows],
    )


@router.post("/me/read-all")
def read_all_my_notifications(
    session: SessionDep, current_user: CurrentUser
) -> dict:
    marked = mark_all_read(session, current_user.id)
    commit_or_conflict(session, "No fue posible marcar las notificaciones.")
    return {"marked": marked}


@router.post("/{notification_id}/read", response_model=NotificationRead)
def read_notification(
    notification_id: uuid.UUID,
    session: SessionDep,
    current_user: CurrentUser,
) -> NotificationRead:
    row = session.get(Notification, notification_id)
    # 404 uniforme: no revela si la notificación de OTRO usuario existe.
    if row is None or row.user_id != current_user.id:
        api_error(status.HTTP_404_NOT_FOUND, "notificacion_no_encontrada", "No encontrada")
    if row.read_at is None:
        row.read_at = utc_now()
        session.add(row)
        commit_or_conflict(session, "No fue posible marcar la notificación.")
    return _read(row)


# ---------------------------------------------------------------------------
# Web Push: clave pública VAPID + suscripción del navegador (recurso propio)
# ---------------------------------------------------------------------------

class PushPublicKeyRead(ApiReadSchema):
    """Clave pública VAPID del despliegue (``applicationServerKey``)."""

    public_key: str


class PushSubscriptionKeys(ApiWriteSchema):
    """Claves de cifrado que genera el navegador (RFC 8291)."""

    p256dh: str = Field(min_length=1, max_length=255)
    auth: str = Field(min_length=1, max_length=255)


class PushSubscribeRequest(ApiWriteSchema):
    """Suscripción tal como la entrega ``PushSubscription.toJSON()``."""

    endpoint: str = Field(min_length=1, max_length=2048)
    keys: PushSubscriptionKeys


class PushUnsubscribeRequest(ApiWriteSchema):
    endpoint: str = Field(min_length=1, max_length=2048)


class PushSubscribeResult(ApiReadSchema):
    saved: bool


class PushUnsubscribeResult(ApiReadSchema):
    removed: bool


@router.get("/push/public-key", response_model=PushPublicKeyRead)
def push_public_key(
    session: SessionDep, _current_user: CurrentUser
) -> PushPublicKeyRead:
    """Genera las credenciales VAPID en el primer uso y entrega la pública."""
    from backend.app.services.push_service import PushConfigError, get_vapid_public_key

    try:
        public_key = get_vapid_public_key(session)
    except PushConfigError as exc:
        api_error(status.HTTP_503_SERVICE_UNAVAILABLE, exc.code, exc.summary)
    commit_or_conflict(session, "No fue posible preparar las credenciales push.")
    return PushPublicKeyRead(public_key=public_key)


@router.put("/push/subscription", response_model=PushSubscribeResult)
def save_push_subscription(
    payload: PushSubscribeRequest,
    session: SessionDep,
    current_user: CurrentUser,
    user_agent: Optional[str] = Header(default=None),
) -> PushSubscribeResult:
    """Alta/refresco de la suscripción de ESTE navegador (upsert por endpoint)."""
    from backend.app.services.push_service import save_subscription

    save_subscription(
        session,
        user_id=current_user.id,
        endpoint=payload.endpoint,
        p256dh=payload.keys.p256dh,
        auth=payload.keys.auth,
        user_agent=user_agent,
    )
    commit_or_conflict(session, "No fue posible guardar la suscripción push.")
    return PushSubscribeResult(saved=True)


@router.post("/push/unsubscribe", response_model=PushUnsubscribeResult)
def remove_push_subscription(
    payload: PushUnsubscribeRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> PushUnsubscribeResult:
    """Baja de la suscripción PROPIA (la de otro usuario 'no existe')."""
    from backend.app.services.push_service import remove_subscription

    removed = remove_subscription(
        session, user_id=current_user.id, endpoint=payload.endpoint
    )
    commit_or_conflict(session, "No fue posible retirar la suscripción push.")
    return PushUnsubscribeResult(removed=removed)


class BroadcastRequest(ApiWriteSchema):
    title: str = Field(min_length=1, max_length=140)
    body: str = Field(min_length=1, max_length=500)
    audience: Literal["all", "customers", "staff"] = "all"
    # Enlace OPCIONAL al tocar la difusión: ruta interna (que empiece con «/») o
    # URL https absoluta. Se rechaza cualquier otra forma (evita javascript:,
    # http sin cifrar, etc.).
    link_url: Optional[str] = Field(default=None, max_length=500)

    @field_validator("link_url")
    @classmethod
    def _validar_enlace(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        candidate = value.strip()
        if candidate == "":
            return None
        if candidate.startswith("/") and not candidate.startswith("//"):
            return candidate
        if candidate.startswith("https://") and len(candidate) > len("https://"):
            return candidate
        raise ValueError(
            "El enlace debe ser una ruta interna (que empiece con «/») o una URL https."
        )


@router.post("/broadcast", status_code=status.HTTP_201_CREATED)
def send_broadcast(
    payload: BroadcastRequest,
    session: SessionDep,
    current_user: CurrentUser,
    _: NotificationPermissions.SEND.requiere,
) -> dict:
    created = broadcast(
        session, title=payload.title, body=payload.body, audience=payload.audience,
        link_url=payload.link_url,
    )
    record_config_change(
        session, actor_user_id=current_user.id, entity_type="notifications",
        entity_id=_BROADCAST_AUDIT_ID, action="broadcast",
        changed_fields=["title", "body", "audience", "link_url"],
    )
    commit_or_conflict(session, "No fue posible enviar la difusión.")
    # Correos best-effort DESPUÉS del commit; el tick Taskiq es la red de seguridad.
    kick_notification_dispatch()
    return {"created": created, "audience": payload.audience}
