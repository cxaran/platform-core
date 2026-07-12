"""Tick de notificaciones: despacha correos y pushes pendientes de la cola.

Red de seguridad del hilo best-effort post-commit (mismo patrón que los ticks
de pedidos y respaldos): consulta trabajo pendiente en la base cada minuto.
``FOR UPDATE SKIP LOCKED`` en ambos despachos evita dobles si el hilo y el
worker coinciden.
"""

import asyncio

from sqlmodel import Session

from backend.app.core.database import engine
from backend.app.services.notification_service import dispatch_pending_emails
from backend.app.services.push_service import dispatch_pending_pushes
from backend.app.taskiq_app import broker


def _run_dispatch() -> None:
    with Session(engine) as session:
        asyncio.run(dispatch_pending_emails(session))
        dispatch_pending_pushes(session)
        session.commit()  # persiste también los failed/skipped marcados


@broker.task(
    task_name="notifications.tick",
    schedule=[
        {
            "cron": "* * * * *",
            "cron_offset": "UTC",
            "schedule_id": "notifications.tick.v1",
        }
    ],
)
async def notifications_tick() -> None:
    await asyncio.to_thread(_run_dispatch)
