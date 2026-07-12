"""Notificaciones persistentes: campana in-app + correo + Web Push.

Las filas se crean DENTRO de la transacción del evento que las dispara: o se
persiste todo o nada. El correo y el push son COLAS sobre la misma fila
(``email_status`` / ``push_status`` = 'pending'):

- ``kick_notification_dispatch()`` — hilo best-effort post-commit: en despliegues
  sin worker Taskiq los avisos salen igual, sin bloquear el request.
- ``notifications.tick`` (Taskiq, por minuto) — red de seguridad que despacha
  lo que un hilo dejó pendiente. ``FOR UPDATE SKIP LOCKED`` evita dobles.

El transporte real del correo es ``send_system_email`` (environment/SMTP/Resend
desde system_settings) y el del push ``push_service.dispatch_pending_pushes``
(pywebpush + VAPID); un fallo marca ``failed`` con resumen SEGURO y jamás
revienta.

Primitivas genéricas (cada proyecto compone las suyas encima):

- ``create_notification`` — crea la fila (sin commit).
- ``notify_user`` — atajo de una notificación ``system`` a un usuario.
- ``notify_users_with_permission`` — a todos los usuarios activos cuyo rol
  otorga cierto permiso (p. ej. avisar a quien pueda atender un evento).
- ``broadcast`` — difusión del administrador a una audiencia.
"""

import asyncio
import logging
import threading
import uuid
from typing import Literal, Optional

from sqlmodel import Session, select

from backend.app.models.notification import Notification
from backend.app.models.user import RoleAccess, User, UserRole
from backend.app.utils.utc_now import utc_now

logger = logging.getLogger("backend.notifications")

EMAIL_BATCH_SIZE = 50


def notification_href(kind: str, link_url: Optional[str]) -> Optional[str]:
    """Destino al tocar la notificación (campana y Web Push comparten esto).

    Base genérica: el destino es el ``link_url`` guardado en la fila (ruta interna
    o URL https), o ``None`` si no hay. Cada proyecto puede sobrescribir este
    mapeo para derivar el destino de sus tipos propios (p. ej. un id de entidad).
    """
    return link_url or None


def create_notification(
    session: Session,
    *,
    user_id: uuid.UUID,
    kind: str,
    title: str,
    body: str,
    link_url: Optional[str] = None,
    email: bool = True,
    push: bool = True,
) -> Notification:
    """Crea la fila (SIN commit): viaja en la transacción del evento."""
    row = Notification(
        user_id=user_id,
        kind=kind,
        title=title[:140],
        body=body[:500],
        link_url=(link_url or None),
        email_status="pending" if email else "skipped",
        push_status="pending" if push else "skipped",
    )
    session.add(row)
    return row


def notify_user(
    session: Session,
    *,
    user_id: uuid.UUID,
    title: str,
    body: str,
    kind: str = "system",
    link_url: Optional[str] = None,
    email: bool = True,
    push: bool = True,
) -> Notification:
    """Atajo: una notificación dirigida a UN usuario (campana + correo + push)."""
    return create_notification(
        session,
        user_id=user_id,
        kind=kind,
        title=title,
        body=body,
        link_url=link_url,
        email=email,
        push=push,
    )


def users_with_permission(session: Session, permission: str) -> list[User]:
    """Usuarios ACTIVOS cuyo rol (activo) otorga ``permission``."""
    rows = session.exec(
        select(User)
        .join(UserRole, UserRole.user_id == User.id)  # pyright: ignore[reportArgumentType]
        .join(RoleAccess, RoleAccess.role_id == UserRole.role_id)  # pyright: ignore[reportArgumentType]
        .where(
            RoleAccess.access == permission,
            RoleAccess.is_active == True,  # noqa: E712
            User.is_active == True,  # noqa: E712
        )
        .distinct()
    ).all()
    return list(rows)


def notify_users_with_permission(
    session: Session,
    *,
    permission: str,
    title: str,
    body: str,
    kind: str = "system",
) -> int:
    """Crea una notificación por cada usuario activo con ``permission``.

    SIN commit: viaja en la transacción del evento. Devuelve cuántas filas creó.
    """
    recipients = users_with_permission(session, permission)
    for user in recipients:
        create_notification(
            session, user_id=user.id, kind=kind, title=title, body=body
        )
    return len(recipients)


Audience = Literal["all", "customers", "staff"]


def broadcast(
    session: Session,
    *,
    title: str,
    body: str,
    audience: Audience = "all",
    link_url: Optional[str] = None,
) -> int:
    """Difusión del administrador (promoción/aviso) a la audiencia elegida.

    ``customers`` = usuarios activos SIN rol asignado (usuarios finales, sin
    acceso administrativo); ``staff`` = con algún rol. Crea UNA fila por usuario
    (campana + correo + push). ``link_url`` opcional = destino al tocarla. SIN
    commit: el router decide la transacción.
    """
    staff_ids = select(UserRole.user_id)
    stmt = select(User).where(User.is_active == True)  # noqa: E712
    if audience == "customers":
        stmt = stmt.where(User.id.not_in(staff_ids))  # pyright: ignore[reportAttributeAccessIssue]
    elif audience == "staff":
        stmt = stmt.where(User.id.in_(staff_ids))  # pyright: ignore[reportAttributeAccessIssue]
    users = session.exec(stmt).all()
    for user in users:
        create_notification(
            session, user_id=user.id, kind="promo", title=title, body=body,
            link_url=link_url,
        )
    return len(users)


# ---------------------------------------------------------------------------
# Despacho de correos (cola sobre email_status)
# ---------------------------------------------------------------------------

async def dispatch_pending_emails(session: Session, *, limit: int = EMAIL_BATCH_SIZE) -> int:
    """Envía los correos pendientes y marca sent/failed. Devuelve enviados.

    Toma las filas con ``FOR UPDATE SKIP LOCKED`` (en PostgreSQL): el hilo
    best-effort y el tick Taskiq pueden correr a la vez sin duplicar correos.
    """
    from backend.app.services.email_service import send_system_email

    stmt = (
        select(Notification)
        .where(Notification.email_status == "pending")
        .order_by(Notification.created_at)  # pyright: ignore[reportArgumentType]
        .limit(limit)
    )
    if session.get_bind().dialect.name == "postgresql":
        stmt = stmt.with_for_update(skip_locked=True)
    rows = session.exec(stmt).all()

    sent = 0
    for row in rows:
        user = session.get(User, row.user_id)
        if user is None or not user.is_active or not user.email:
            row.email_status = "skipped"
            session.add(row)
            continue
        outcome = await send_system_email(
            session,
            subject=row.title,
            email_to=user.email,
            message=row.body,
        )
        if outcome.sent:
            row.email_status = "sent"
            row.email_error = None
            sent += 1
        else:
            row.email_status = "failed"
            row.email_error = (outcome.error_summary or outcome.error_code or "error")[:200]
        session.add(row)
    session.flush()
    return sent


def kick_notification_dispatch() -> None:
    """Hilo best-effort post-commit: correos + pushes pendientes (jamás afecta
    la transacción del evento)."""

    def _runner() -> None:
        try:
            from backend.app.core.database import engine
            from backend.app.services.push_service import dispatch_pending_pushes

            with Session(engine) as session:
                asyncio.run(dispatch_pending_emails(session))
                dispatch_pending_pushes(session)
                session.commit()
        except Exception:  # noqa: BLE001 — best-effort explícito
            logger.warning("notification_dispatch_failed")

    threading.Thread(target=_runner, name="notification-dispatch", daemon=True).start()


def unread_count(session: Session, user_id: uuid.UUID) -> int:
    rows = session.exec(
        select(Notification.id).where(
            Notification.user_id == user_id,
            Notification.read_at.is_(None),  # pyright: ignore[reportAttributeAccessIssue]
        )
    ).all()
    return len(rows)


def mark_all_read(session: Session, user_id: uuid.UUID) -> int:
    rows = session.exec(
        select(Notification).where(
            Notification.user_id == user_id,
            Notification.read_at.is_(None),  # pyright: ignore[reportAttributeAccessIssue]
        )
    ).all()
    now = utc_now()
    for row in rows:
        row.read_at = now
        session.add(row)
    session.flush()
    return len(rows)
