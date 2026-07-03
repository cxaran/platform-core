"""Única tarea real de Taskiq: el TICK de respaldos.

Taskiq NO es la fuente de verdad del horario: el tick corre cada minuto (cron FIJO en
UTC, no editable) y sólo consulta PostgreSQL — ``backup_settings.next_run_at`` para
crear la ejecución programada vencida y ``backup_runs.next_attempt_at`` para reclamar
reintentos. El usuario cambia hora/zona/retención o reconecta Drive sin reiniciar el
scheduler. Cuando no hay trabajo vencido, el tick no registra logs ni hace trabajo.
"""

import asyncio

from backend.app.services.backup_service import backup_service
from backend.app.taskiq_app import broker


@broker.task(
    task_name="backups.tick",
    schedule=[
        {
            "cron": "* * * * *",
            "cron_offset": "UTC",
            "schedule_id": "backups.tick.v1",
        }
    ],
)
async def backups_tick() -> None:
    # El backend usa sesiones síncronas y herramientas bloqueantes (pg_dump,
    # pg_restore, age, cliente de Google): a un thread para no bloquear el loop.
    await asyncio.to_thread(backup_service.run_tick)
