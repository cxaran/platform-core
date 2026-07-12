# Tareas en segundo plano con Taskiq (base mínima)

## Qué es y qué problema resuelve

Platform Core necesita una vía para ejecutar trabajo **fuera del ciclo request/response** de
FastAPI (en el futuro: respaldos, correos informativos, notificaciones, recordatorios,
limpiezas programadas). Esta base lo resuelve con [Taskiq](https://taskiq-python.github.io/)
sobre **PostgreSQL** — sin Redis, Celery ni infraestructura adicional: la cola vive en la
misma base de datos que ya opera el consultorio.

Es una **capacidad de plataforma**: no toca los recursos de la aplicación ni los
permisos. Su primer consumidor real son los **respaldos cifrados hacia Google
Drive** (`docs/backups-google-drive.md`), vía la tarea `backups.tick`.

## Principio arquitectónico

La API y los procesos de fondo están **separados por diseño**:

```
proceso FastAPI                 procesos Taskiq (profile "taskiq")
──────────────                  ──────────────────────────────────
publica (kick)                  taskiq-worker    → ejecuta tareas
   task.kiq() ──► PostgreSQL ◄─ taskiq-scheduler → encola las programadas (cron)
                 (tabla del broker)
```

- FastAPI **nunca** levanta el worker ni el scheduler (ni `BackgroundTasks`). Son
  servicios Docker propios, opt-in por profile. El lifespan de la API sólo inicia el
  broker para PUBLICAR (p. ej. despertar el tick tras "Respaldar ahora"); un fallo del
  broker no impide arrancar la API.
- El broker usa un canal y una tabla **propios** (`platform_core_taskiq`,
  `platform_core_taskiq_messages`). La tabla la crea el broker en su `startup()`; **no** hay
  migración Alembic ni modelo SQLAlchemy — no forma parte del esquema de la aplicación.
- El broker reutiliza el `postgres_dsn` existente convertido con `make_url`
  (`postgresql+psycopg2://…` → `postgresql://…`); usa psycopg v3 internamente y convive
  con el psycopg2 del resto del backend. El DSN contiene la contraseña: **no se loguea**.

## Piezas (todas en `backend/app/taskiq_app.py`)

| Pieza | Qué hace |
| --- | --- |
| `taskiq_dsn(dsn)` | Convierte el DSN de SQLAlchemy al que espera psycopg (drivername `postgresql`), conservando credenciales, host, base y query params. |
| `broker` | `PsycopgBroker` único. Sin result backend ni serializer custom. Importar el módulo **no** abre conexiones. |
| `backups.tick` | Única tarea real (vive en `backend/app/jobs/tasks/backups.py`): cron FIJO por minuto (UTC) que consulta trabajo VENCIDO de respaldos en PostgreSQL (ver `docs/backups-google-drive.md`). Sin trabajo vencido no hace nada. |
| `scheduler` | `TaskiqScheduler` con `LabelScheduleSource` (lee los schedules declarados como labels de las tareas). Sin fuentes dinámicas. |

## Configuración

El schedule del tick es FIJO (cada minuto, UTC) y no se configura: el horario REAL de
los respaldos vive en la tabla `backup_settings` (editable desde la UI sin reiniciar
nada) y el interruptor global es `BACKUPS_ENABLED=false` (default). Con los defaults,
worker y scheduler arrancan y el tick no hace nada (sale de inmediato).

## Cómo ejecutar el worker y el scheduler

Servicios Docker **opt-in** (no se levantan con `docker compose up` normal):

```bash
docker compose -f compose.dev.yml --profile taskiq up taskiq-worker taskiq-scheduler
```

- `taskiq-worker`: `taskiq worker backend.app.taskiq_app:broker --workers 1 --max-async-tasks 1`
- `taskiq-scheduler`: `taskiq scheduler backend.app.taskiq_app:scheduler --skip-first-run`
  — mantener **una sola réplica** del scheduler.

Localmente (venv activo, desde la raíz del repo) los mismos comandos funcionan sin Docker.

Nota del primer arranque: si worker y scheduler arrancan a la vez sobre una base donde la
tabla del broker aún no existe, ambos ejecutan su `CREATE TABLE IF NOT EXISTS` y PostgreSQL
puede lanzar `UniqueViolation` en `pg_type` (carrera conocida de Postgres). El
`restart: unless-stopped` del compose la absorbe: el segundo intento encuentra la tabla.

## Cómo probar el ciclo completo (sin frontend)

```bash
docker compose -f compose.dev.yml run --rm --no-deps backend python -c "
import asyncio
from backend.app.taskiq_app import broker
from backend.app.jobs.tasks.backups import backups_tick

async def main():
    await broker.startup()
    task = await backups_tick.kiq()
    print('encolada:', task.task_id)
    await broker.shutdown()

asyncio.run(main())
"
docker logs platform-core-dev-taskiq-worker-1 | tail -3
# → "Executing task backups.tick with ID: …" (y nada más si no hay trabajo vencido)
```

Tests: `backend/tests/test_taskiq_app.py` (unitarios de DSN/importación aislada +
integración real de `startup`/`shutdown` del broker contra el Postgres de pruebas, con
canal y tabla temporales). Correr con la suite backend habitual; la integración requiere
`TEST_POSTGRES_URL` apuntando a una base `*_test`.

## Cómo registrar una tarea nueva

1. Crear el módulo en `backend/app/jobs/tasks/` e importarlo al FINAL de
   `backend/app/taskiq_app.py` (registro EXPLÍCITO; la tarea importa `broker` de ahí):

   ```python
   @broker.task(task_name="system.mi_tarea")
   async def system_mi_tarea(...) -> None:
       ...
   ```

2. Si es programada, declarar el schedule como label (`schedule=[{"cron": ...,
   "cron_offset": <zona IANA o UTC>, "schedule_id": "<nombre>.vN"}]`). Patrón preferido
   para horarios EDITABLES: un tick fijo barato que consulta la verdad en PostgreSQL
   (como `backups.tick`), no schedules dinámicos.
3. Reglas de contenido: los argumentos y resultados de las tareas **no deben llevar datos
   sensibles ni texto libre de usuarios** (usar referencias mínimas: ids). Nada de secretos en logs.
4. Para encolar desde la API: `await mi_tarea.kiq(...)` — el broker ya se inicia en el
   lifespan de FastAPI (sólo como productor). El encolado debe ser NO fatal: la cola es
   durable y el tick/schedule procesa lo pendiente aunque el kick falle.

## Qué queda explícitamente fuera de esta base

- Result backend y tablas de resultados (las tareas no devuelven valores consultables).
- Schedules dinámicos en base de datos (`PsycopgScheduleSource`): el schedule es estático
  por label.
- SMTP/correos reales, push/WebSockets y recordatorios de citas: fases futuras que se
  montarán **sobre** esta base como tareas registradas, sin rediseñar nada.
- Redis, Celery, RabbitMQ y `taskiq-fastapi`.
