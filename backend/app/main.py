from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from backend.app.api.router import router as api_router
from backend.app.core.csrf import MutationOriginGuardMiddleware
from backend.app.core.error_handlers import register_exception_handlers
from backend.app.core.request_logging import RequestLoggingMiddleware, configure_logging
from backend.app.core.settings import settings


configure_logging()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
    """Ciclo de vida de la API. Carga el dominio verificado persistido (los orígenes
    verificados solo AÑADEN a los del entorno) e inicia el broker de Taskiq SOLO para
    PUBLICAR tareas (p. ej. despertar el tick tras un respaldo manual); el worker y el
    scheduler siguen siendo procesos propios (profile "taskiq"), nunca hijos de
    FastAPI. Un fallo del broker no impide arrancar la API (la cola es durable: el
    tick programado procesa lo pendiente igual)."""
    from backend.app.core.runtime_origins import load_from_database
    from backend.app.taskiq_app import broker

    load_from_database()

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


app = FastAPI(
    title=settings.project_name,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# El guard se agrega antes que el logging para que el logging quede exterior y
# registre también las solicitudes rechazadas por origen.
app.add_middleware(MutationOriginGuardMiddleware)
app.add_middleware(RequestLoggingMiddleware)
register_exception_handlers(app)
app.include_router(api_router)
