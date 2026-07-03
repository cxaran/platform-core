ARG PYTHON_VERSION=3.12-slim

FROM python:${PYTHON_VERSION} AS deps

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

WORKDIR /app

# Herramientas de RESPALDO (misma imagen para API, worker y scheduler):
# - postgresql-client (v17 en trixie): pg_dump/pg_restore sirven contra el Postgres 16
#   del stack (pg_dump debe ser >= a la versión del servidor). Sin repos externos.
# - age: cifrado del archivo de respaldo con la clave PÚBLICA del administrador (la
#   privada nunca entra a la imagen ni al repositorio).
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client age \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM deps AS dev
COPY . backend/
EXPOSE 8000
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

FROM deps AS prod
COPY . backend/
EXPOSE 8000
CMD ["gunicorn", "backend.app.main:app", "-k", "uvicorn.workers.UvicornWorker", "--bind", "0.0.0.0:8000", "--workers", "4"]
