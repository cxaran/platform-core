from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from backend.app.api.router import router as api_router
from backend.app.core.csrf import CrossSiteMutationGuardMiddleware
from backend.app.core.error_handlers import register_exception_handlers
from backend.app.core.request_logging import RequestLoggingMiddleware, configure_logging
from backend.app.core.settings import settings


configure_logging()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
    """Ciclo de vida de la API. Inicia el broker de Taskiq SOLO para PUBLICAR tareas
    (p. ej. despertar el tick tras un respaldo manual); el worker y el scheduler
    siguen siendo procesos propios (profile "taskiq"), nunca hijos de FastAPI. Un
    fallo del broker no impide arrancar la API (la cola es durable: el tick
    programado procesa lo pendiente igual)."""
    from backend.app.taskiq_app import broker

    try:
        await broker.startup()
    except Exception:
        import logging

        logging.getLogger("backend.request").warning("taskiq_broker_startup_failed")
    yield
    try:
        await broker.shutdown()
    except Exception:
        pass


API_VERSION = "1.0.0"
API_DESCRIPTION = """\
Base de plataforma (FastAPI + Next.js, self-hosted, instalación única):
autenticación por sesión, RBAC declarado en código, administración por contrato
y respaldos cifrados.
"""

app = FastAPI(
    title=settings.project_name,
    summary="API de la plataforma base (autenticación, RBAC y administración por contrato).",
    description=API_DESCRIPTION,
    version=API_VERSION,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# El guard se agrega antes que el logging para que el logging quede exterior y
# registre también las solicitudes rechazadas por origen.
app.add_middleware(CrossSiteMutationGuardMiddleware)
app.add_middleware(RequestLoggingMiddleware)

# Renovación deslizante de sesión: pasada la mitad de la vida del JWT, la
# cookie se re-emite con el mismo ttl/jti (ver backend/app/auth/session_refresh.py).
from backend.app.auth.session_refresh import sliding_session_middleware  # noqa: E402

app.middleware("http")(sliding_session_middleware)
register_exception_handlers(app)
app.include_router(api_router)

# Zona horaria de calendario como POLÍTICA editable: se registra el resolver cacheado
# de system_settings en el motor de query (sin resolver, el motor usa el snapshot del
# entorno — mismo comportamiento histórico, p. ej. en tests unitarios del motor).
from backend.app.query.compiler import set_calendar_timezone_resolver  # noqa: E402
from backend.app.services.system_settings_service import (  # noqa: E402
    cached_application_timezone,
)

set_calendar_timezone_resolver(cached_application_timezone)

# Métricas Prometheus en /metrics — FUERA de /api a propósito: nginx solo proxya
# /api/, así que el endpoint queda accesible únicamente dentro de la red del stack
# (scraping interno; jamás público). Con gunicorn multi-worker, la agregación entre
# procesos usa PROMETHEUS_MULTIPROC_DIR (lo define compose; aquí se garantiza el dir).
import os  # noqa: E402

from prometheus_fastapi_instrumentator import Instrumentator  # noqa: E402

_multiproc_dir = os.environ.get("PROMETHEUS_MULTIPROC_DIR")
if _multiproc_dir:
    os.makedirs(_multiproc_dir, exist_ok=True)
Instrumentator(
    excluded_handlers=["/metrics", "/api/health"],
).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
