"""Módulo Taskiq del backend: broker PostgreSQL, tareas y scheduler estático.

El worker y el scheduler corren en procesos PROPIOS (servicios Docker con profile
"taskiq"); FastAPI sólo inicia el broker en su lifespan para PUBLICAR tareas (nunca
levanta worker ni scheduler). La cola vive en PostgreSQL (canal/tabla dedicados del
broker), sin Redis ni Celery, y reutiliza el ``postgres_dsn`` existente (el broker usa
psycopg v3; el resto del backend sigue en psycopg2).

Única tarea registrada: ``backups.tick`` (ver ``backend/app/jobs/tasks/backups.py``) —
un cron FIJO por minuto en UTC que sólo consulta trabajo vencido en PostgreSQL. El
horario REAL de los respaldos vive en la tabla ``backup_settings``, no aquí: cambiar
la hora, la zona o la retención no requiere reiniciar el scheduler.

Ejecución (ver compose, profile "taskiq"):
    taskiq worker backend.app.taskiq_app:broker --workers 1 --max-async-tasks 1
    taskiq scheduler backend.app.taskiq_app:scheduler --skip-first-run
"""

from sqlalchemy.engine import make_url
from taskiq import TaskiqScheduler
from taskiq.schedule_sources import LabelScheduleSource
from taskiq_pg.psycopg import PsycopgBroker

from backend.app.core.settings import settings


def taskiq_dsn(postgres_dsn: str) -> str:
    """DSN para el broker a partir del DSN de SQLAlchemy del proyecto.

    Cambia sólo el drivername a ``postgresql`` (psycopg no acepta el sufijo
    ``+psycopg2`` de SQLAlchemy) conservando usuario, contraseña, host, puerto, base
    y parámetros. Vía ``make_url`` — nunca reemplazos manuales de strings. El DSN
    contiene la contraseña: no loguearlo.
    """
    url = make_url(postgres_dsn)
    return url.set(drivername="postgresql").render_as_string(
        hide_password=False,
    )


# Broker único sobre PostgreSQL, con canal y tabla EXPLÍCITOS y propios (no toca las
# tablas de la app). Sin result backend ni serializer custom. El ciclo de vida
# (startup/shutdown) lo maneja el CLI de taskiq en el worker/scheduler y el lifespan de
# FastAPI en la API (para publicar); importar este módulo NO abre conexiones.
broker = PsycopgBroker(
    dsn=taskiq_dsn(str(settings.postgres_dsn)),
    channel_name="platform_core_taskiq",
    table_name="platform_core_taskiq_messages",
)


# Scheduler estático: lee los schedules declarados como LABELS de las tareas de este
# broker. Sin fuentes dinámicas ni tablas de schedules.
scheduler = TaskiqScheduler(
    broker=broker,
    sources=[LabelScheduleSource(broker)],
)


# Registro EXPLÍCITO de tareas (imports al final: las tareas importan ``broker`` de
# este módulo, ya definido en este punto). El scheduler ve sus labels vía el broker.
from backend.app.jobs.tasks import backups as _backups_tasks  # noqa: E402,F401
