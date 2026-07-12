"""Tarea diaria de mantenimiento: retención de datos operativos.

Cron FIJO (03:17 UTC — hora valle, minuto no redondo para no coincidir con otros
crons del ecosistema). La política real (cuántos días conservar) vive en
``system_settings`` y es editable en runtime; con ambas retenciones en NULL la
tarea no hace nada.
"""

import asyncio

from sqlmodel import Session

from backend.app.core.database import engine
from backend.app.services.maintenance_service import run_retention
from backend.app.taskiq_app import broker


def _run() -> None:
    with Session(engine) as session:
        run_retention(session)
        session.commit()


@broker.task(
    task_name="maintenance.retention",
    schedule=[
        {
            "cron": "17 3 * * *",
            "cron_offset": "UTC",
            "schedule_id": "maintenance.retention.v1",
        }
    ],
)
async def maintenance_retention() -> None:
    # Sesión síncrona y DELETEs potencialmente largos: a un thread, como backups.tick.
    await asyncio.to_thread(_run)
