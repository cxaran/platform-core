# Actualización

Un solo comando encapsula el ciclo completo — seguro y sin dejar basura en el servidor:

```bash
./scripts/update.sh
```

## Qué hace, en orden

1. **Preflight**: exige repo limpio, `git fetch`, muestra los commits entrantes y pide
   confirmación (si no hay entrantes, sale).
2. **Respaldo pre-update local** (`pg_dump -Fc` dentro del contenedor, independiente de
   Drive), rotado — se conservan los 3 más recientes en `backups-preupdate/`. Aborta si el
   dump queda vacío.
3. `git pull --ff-only origin main` (compose, migraciones, documentación).
4. **Descarga las imágenes del commit** (`sha-<corto>`) publicadas por el CI en GHCR — el
   servidor **no construye nada**: cero carga de CPU, cero caché de build. Si el CI aún
   está publicando, espera (reintenta hasta ~15 min); si está en rojo, aborta.
5. **Ventana breve**: detiene backend y tareas → aplica migraciones → levanta el stack
   actualizado. Así el código y el esquema nunca conviven desalineados. (`--no-stop` para
   cambios sin migraciones incompatibles.)
6. **Verificación**: healthcheck del backend + `alembic current` en head; si falla, deja
   impresas las salidas para decidir el rollback.
7. **Higiene**: conserva las 3 últimas imágenes por servicio (rollback rápido) y poda el
   resto (+ `docker image prune`). El disco no crece con cada update.

El tag desplegado queda registrado en el `.env` (`IMAGE_TAG=sha-…`): cualquier
`docker compose up -d` posterior usa exactamente esas imágenes.

## Rollback

El código vuelve atrás en segundos:

```bash
./scripts/update.sh --rollback sha-<anterior>   # el propio update lo imprime
```

El rollback **no revierte el esquema**. Si el update aplicó migraciones, restaura primero
el dump pre-update:

```bash
docker compose stop backend taskiq-worker taskiq-scheduler
./scripts/restore.sh --to-production backups-preupdate/pre-update-<fecha>.dump
./scripts/update.sh --rollback sha-<anterior>
```

## El CI que lo hace posible

En cada push a `main`, GitHub Actions corre las **tres suites canónicas** (backend contra
PostgreSQL real, gateway y frontend con verificación de drift del contrato) y, **solo en
verde**, publica las imágenes en GHCR (`ghcr.io/cxaran/platform-core-*`) con los tags
`latest` y `sha-<corto>`. El servidor consume; nunca compila.

!!! note "Sin registry"
    `./scripts/update.sh --build` construye localmente (fork sin CI, o registry
    inaccesible). En ese modo la higiene incluye la poda del caché de BuildKit (se conserva
    la última semana).
