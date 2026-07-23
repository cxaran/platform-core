# Solución de problemas

Runbook de los incidentes más probables, en orden de urgencia.

## Nadie puede iniciar sesión (Redis caído)

**Síntomas:** el login devuelve error de servicio; `docker compose ps` muestra `redis`
reiniciando o unhealthy.

**Por qué:** el rate limiting de las rutas de autenticación es **fail-closed en
producción** (deliberado: sin límites no se aceptan intentos). Redis caído ⇒ login
bloqueado para todos, administradores incluidos.

**Pasos:**

1. `docker compose ps redis` y `docker compose logs redis --tail 50`.
2. Reinicio: `docker compose restart redis`. La mayoría de los casos termina aquí (los
   datos de Redis son efímeros: tokens y contadores; perderlos es seguro).
3. Si el volumen está corrupto: `docker compose down redis && docker volume rm
   platform-core_redis_data && docker compose up -d redis` — se pierden tokens de
   desbloqueo/verificación pendientes, nada permanente.

**Salida de emergencia** (último recurso, consciente): deshabilitar el rate limiting
temporalmente para recuperar acceso administrativo:

```bash
# en el .env:  RATE_LIMIT_ENABLED=false
docker compose up -d backend
```

⚠ Sin límites de intentos, las rutas de auth quedan expuestas a fuerza bruta: revierte
(`RATE_LIMIT_ENABLED=true` o elimina la línea) en cuanto Redis vuelva.

## nginx en crash-loop al arrancar

**Síntomas:** `nginx` reinicia sin parar tras un `up -d` en frío.

**Por qué:** nginx valida sus upstreams al cargar la configuración. El compose ya ordena el
arranque por readiness (`service_healthy`), así que esto solo debería ocurrir si un
upstream **nunca** llega a sano.

**Pasos:** `docker compose ps` → identifica el servicio unhealthy → sus logs. Los casos
típicos: backend sin `.env` completo (falla al importar, con el motivo en el log) o
migraciones pendientes.

## El backend arranca pero la API da errores 500 de esquema

**Por qué:** migraciones pendientes tras una actualización.

```bash
docker compose --profile migrate run --rm migrate
docker compose restart backend
```

## Los respaldos dejaron de correr

1. Revisa la notificación (campana/correo): un fallo definitivo o `needs_reauth` **avisan
   activamente** a quienes pueden configurarlos.
2. `needs_reauth`: reconecta Google Drive desde el panel de respaldos — los reintentos
   quedan detenidos a propósito hasta reconectar.
3. ¿Están corriendo worker y scheduler? Son opt-in: `docker compose --profile taskiq up -d
   taskiq-worker taskiq-scheduler`.
4. El primer arranque de worker+scheduler puede chocar creando la tabla del broker
   (UniqueViolation en `pg_type`); el reinicio automático lo absorbe.

## Disco lleno

- Los logs de Docker ya rotan (10 MB × 3 por servicio) — no son la causa.
- Sospechosos habituales: volúmenes de PostgreSQL, artefactos temporales de respaldo
  (`BACKUP_TEMP_DIR`, se limpian por ejecución) e imágenes Docker viejas: `docker system
  df` y `docker image prune`.
- La bitácora y las notificaciones se podan según la retención configurada en Configuración
  del sistema (vacío = conservar todo — configúrala).

## El copiloto aparece "No disponible"

1. `docker compose ps model-gateway` — ¿healthy?
2. Los secretos deben COINCIDIR entre backend y gateway:
   `AGENT_GATEWAY_TICKET_SIGNING_SECRET` = `GATEWAY_AGENT_TICKET_SECRET` y
   `AGENT_GATEWAY_INTERNAL_SECRET` = `GATEWAY_BACKEND_INTERNAL_SECRET`.
3. Para un turno real hace falta una credencial de proveedor activa (Mi cuenta →
   Proveedores de IA) y el proveedor habilitado (`GATEWAY_<PROVEEDOR>_ENABLED`).

## Restaurar un respaldo

Ver [respaldos → restauración y simulacro](respaldos.md#restauracion-y-simulacro).
