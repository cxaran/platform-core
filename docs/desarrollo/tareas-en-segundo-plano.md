# Tareas en segundo plano (Taskiq)

## Qué resuelve

Platform Core necesita ejecutar trabajo **fuera del ciclo request/response** de
FastAPI: respaldos, retención de datos, entrega de notificaciones, y cualquier
trabajo programado futuro. Lo resuelve con [Taskiq](https://taskiq-python.github.io/)
sobre **PostgreSQL** — sin Redis, Celery ni infraestructura adicional: la cola vive en
la misma base de datos que ya opera la instalación.

Es una **capacidad de plataforma**: no toca los recursos de la aplicación ni los
permisos. Sus consumidores hoy son los respaldos, la retención y las notificaciones.

## Principio arquitectónico

La API y los procesos de fondo están **separados por diseño**:

```
proceso FastAPI                 procesos Taskiq (profile "taskiq")
──────────────                  ──────────────────────────────────
publica (kick)                  taskiq-worker    → ejecuta tareas
   task.kiq() ──► PostgreSQL ◄─ taskiq-scheduler → encola las programadas (cron)
                 (tabla del broker)
```

- FastAPI **nunca** levanta el worker ni el scheduler (ni usa `BackgroundTasks`). Son
  servicios Docker propios, opt-in por profile. El lifespan de la API solo inicia el
  broker para PUBLICAR (p. ej. despertar el tick tras "Respaldar ahora"); un fallo del
  broker no impide arrancar la API.
- El broker usa un canal y una tabla **propios** (`platform_core_taskiq`,
  `platform_core_taskiq_messages`), creados por el broker en su `startup()`; **no** hay
  migración Alembic ni modelo SQLAlchemy — no forma parte del esquema de la aplicación.
- El broker reutiliza el `postgres_dsn` existente convertido con `make_url`
  (`postgresql+psycopg2://…` → `postgresql://…`); usa psycopg v3 internamente y convive
  con el psycopg2 del resto del backend. El DSN contiene la contraseña: **no se loguea**.

## Piezas

Todo el cableado vive en `backend/app/taskiq_app.py`; las tareas en
`backend/app/jobs/tasks/`.

| Pieza | Qué hace |
| --- | --- |
| `taskiq_dsn(dsn)` | Convierte el DSN de SQLAlchemy al que espera psycopg, conservando credenciales, host, base y query params. |
| `broker` | `PsycopgBroker` único. Sin result backend ni serializer custom. Importar el módulo **no** abre conexiones. |
| `scheduler` | `TaskiqScheduler` con `LabelScheduleSource` (lee los schedules declarados como labels de las tareas). Sin fuentes dinámicas. |

Tareas registradas (cron FIJO por minuto salvo indicación):

- **`backups.tick`** — consulta trabajo de respaldos VENCIDO en `backup_settings.next_run_at`
  y lo procesa; ver [respaldos](../operacion/respaldos.md). Sin trabajo vencido, no hace nada.
- **`notifications.tick`** — entrega notificaciones pendientes (correo/Web Push).
- **`maintenance.retention`** — barrido diario de retención de datos operativos.

El horario y la retención REALES de los respaldos viven en la tabla `backup_settings`
(editable desde la UI sin reiniciar nada); el tick solo actúa sobre lo vencido. El
kill-switch de emergencia es `BACKUPS_ENABLED=false`.

## Ejecutar el worker y el scheduler

Servicios Docker **opt-in** (no se levantan con `docker compose up` normal):

```bash
docker compose -f compose.dev.yml --profile taskiq up taskiq-worker taskiq-scheduler
```

- `taskiq-worker`: `taskiq worker backend.app.taskiq_app:broker --workers 1 --max-async-tasks 1`
- `taskiq-scheduler`: `taskiq scheduler backend.app.taskiq_app:scheduler --skip-first-run`
  — mantener **una sola réplica** del scheduler.

Localmente (venv activo, desde la raíz del repo) los mismos comandos funcionan sin Docker.

Nota del primer arranque: si worker y scheduler arrancan a la vez sobre una base donde
la tabla del broker aún no existe, ambos ejecutan su `CREATE TABLE IF NOT EXISTS` y
PostgreSQL puede lanzar `UniqueViolation` en `pg_type` (carrera conocida). El
`restart: unless-stopped` del compose la absorbe: el segundo intento encuentra la tabla.

## Registrar una tarea nueva

1. Crea el módulo en `backend/app/jobs/tasks/` e impórtalo al FINAL de
   `backend/app/taskiq_app.py` (registro EXPLÍCITO; la tarea importa `broker` de ahí):

   ```python
   @broker.task(task_name="system.mi_tarea")
   async def system_mi_tarea(...) -> None:
       ...
   ```

2. Si es programada, declara el schedule como label (`schedule=[{"cron": ...,
   "cron_offset": "<zona IANA o UTC>", "schedule_id": "<nombre>.vN"}]`). Patrón
   preferido para horarios EDITABLES: un tick fijo barato que consulta la verdad en
   PostgreSQL (como `backups.tick`), no schedules dinámicos.
3. Contenido: los argumentos y resultados de las tareas **no deben llevar datos
   sensibles ni texto libre de usuarios** (usa referencias mínimas: ids). Nada de
   secretos en logs.
4. Para encolar desde la API: `await mi_tarea.kiq(...)` — el broker ya se inicia en el
   lifespan de FastAPI (solo como productor). El encolado debe ser NO fatal: la cola es
   durable y el tick/schedule procesa lo pendiente aunque el kick falle.

## Fuera de alcance

Result backend y tablas de resultados, schedules dinámicos en base de datos, y colas
externas (Redis, Celery, RabbitMQ). Las nuevas capacidades se montan **sobre** esta
base como tareas registradas, sin rediseñar nada.
