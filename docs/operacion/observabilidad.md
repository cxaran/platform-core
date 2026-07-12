# Observabilidad

Qué mirar para saber que la instalación está sana, y dónde engancharse con
herramientas externas.

## Salud (health)

| Endpoint | Servicio | Público |
| --- | --- | --- |
| `GET /api/health` | backend | Sí (vía nginx) — respuesta `{"status": "ok"}` |
| `GET /healthz` · `/readyz` | model-gateway | No (solo red interna) |
| `GET /docs/` | docs | Sí |

Los cuatro servicios de aplicación tienen **healthcheck de Docker**: `docker
compose ps` muestra `healthy`/`unhealthy` de un vistazo, y el arranque está
ordenado por readiness (nginx no arranca hasta que sus upstreams responden).

```bash
docker compose ps                 # estado de salud de todos los servicios
docker compose logs -f backend    # logs en vivo (rotados: 10 MB × 3 archivos)
```

## Métricas Prometheus

Dos endpoints **internos** (nginx no los publica; solo son accesibles dentro de
la red del stack — un Prometheus que corra junto al stack puede rasparlos por el
nombre del servicio):

| Endpoint | Qué expone |
| --- | --- |
| `backend:8000/metrics` | Latencia/estatus/volumen por handler HTTP (instrumentación FastAPI). Con gunicorn multi-worker, agregado vía `PROMETHEUS_MULTIPROC_DIR` (ya configurado en compose). |
| `model-gateway:8081/metrics` | Métricas del runtime del copiloto (prom-client). |

Ejemplo mínimo de `scrape_config` para un Prometheus en la misma red Docker:

```yaml
scrape_configs:
  - job_name: platform-core
    static_configs:
      - targets: ["backend:8000", "model-gateway:8081"]
```

## Alertas dentro del producto

Los eventos operativos críticos generan una **notificación activa** (campana +
correo + Web Push) a los usuarios con permiso de configurar respaldos:

- Respaldo **fallido definitivo** (agotó reintentos).
- Google Drive **requiere reconexión** (los respaldos quedan detenidos).

Además del estado persistente en el panel de respaldos (`last_error_*`), que el
primer éxito posterior despeja.

## Logs

- Todos los servicios rotan sus logs (`json-file`, 10 MB × 3) — el disco no se
  llena por logs.
- El backend registra cada request con método, ruta, status y duración; los
  resúmenes de error de respaldos son seguros (nunca tokens/rutas/SQL).
- Para agregación externa (Loki, CloudWatch…), engancha el driver de logging de
  Docker del servicio que te interese.

## Retención de datos operativos

La bitácora de auditoría y las notificaciones se podan a diario según la
política editable en **Configuración del sistema** (vacío = conservar todo).
Las notificaciones **no leídas nunca se podan**. Requiere los servicios de
tareas (`--profile taskiq`).
