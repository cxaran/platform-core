# Instalación

Despliegue de producción en un VPS **desde cero**: un solo script hace todo el
camino y termina con la API sana y el token del asistente en pantalla.

## Requisitos

- Un VPS con **Docker (Compose v2)** y `openssl`.
- Para HTTPS automático: un **dominio** con registro A/AAAA apuntando al VPS y
  los puertos **80 y 443** abiertos en el firewall.

## Instalar

```bash
git clone <repositorio>
cd platform-core
./scripts/install.sh
```

El instalador pregunta solo dos cosas y hace el resto:

**1 · Acceso público (TLS)** — tres modos:

| Modo | Qué hace |
| --- | --- |
| **Dominio con HTTPS automático** (recomendado) | Levanta Caddy delante de nginx: obtiene y renueva solo los certificados de Let's Encrypt. |
| Detrás de mi propio proxy | Tú terminas HTTPS; el stack queda en `127.0.0.1:<puerto>` para tu proxy. |
| Solo pruebas HTTP | Modo *staging* sin dominio. ⚠ No usar con datos reales (las cookies seguras de producción exigen HTTPS). |

**2 · Base de datos PostgreSQL:**

| Modo | Qué hace |
| --- | --- |
| **Contenedor local** (recomendado en un VPS) | PostgreSQL 16 del propio stack, con volumen Docker y contraseña generada. |
| Servidor externo | Pide host, puerto, usuario, contraseña y base. |

Después, automáticamente: genera el `.env` con **todos los secretos únicos**
(sesiones, cifrado Fernet, token de Bootstrap, par de secretos del copiloto),
construye las imágenes, levanta PostgreSQL si es local, **aplica las
migraciones**, arranca el stack completo (incluidos worker y scheduler de
tareas: respaldos, retención y correos de alertas) y **espera a que la API esté
sana** antes de mostrarte el token.

Al terminar: abre `https://tu-dominio.com/setup`, introduce el token y el
asistente crea la cuenta administradora.

!!! tip "¿Instalación interrumpida?"
    `./scripts/install.sh --resume` re-ejecuta la orquestación con el `.env`
    existente (no regenera secretos). Y `--print-env` muestra el `.env` que se
    generaría, sin escribir nada — útil para revisar antes.

!!! note "Todo lo demás se configura desde la interfaz"
    Correo saliente, dominio verificado, respaldos a Google Drive, retención de
    datos, marca de la PWA y el copiloto se configuran **autenticado y auditado
    desde la UI** — sin volver a tocar archivos. Ver
    [puesta en marcha](../producto/puesta-en-marcha.md).

## Servicios del stack

| Servicio | Rol | Cuándo existe |
| --- | --- | --- |
| `caddy` | HTTPS automático (80/443 → nginx) | perfil `tls` |
| `nginx` | Enrutador interno de origen único (`/api/`, `/docs/`, `/model-gateway/`, frontend) | siempre |
| `backend` | FastAPI (datos, RBAC, contrato) — non-root, con healthcheck | siempre |
| `frontend` | Next.js (interfaz dirigida por contrato) | siempre |
| `model-gateway` | Runtime del copiloto (provider-neutral) | siempre |
| `docs` | Este sitio (MkDocs con recarga automática) | siempre |
| `postgres` | PostgreSQL 16 local con volumen | perfil `db` |
| `redis` | Rate limiting y tokens efímeros | siempre |
| `taskiq-worker/scheduler` | Tareas en segundo plano | perfil `taskiq` (el instalador lo activa) |
| `migrate` | Migraciones Alembic bajo demanda | perfil `migrate` |

Los perfiles activos de **tu** instalación viven en el `.env`
(`COMPOSE_PROFILES=…`): cualquier `docker compose up -d` posterior los respeta.
El arranque está ordenado por *readiness* (healthchecks) y todos los servicios
rotan sus logs.

## Actualización

```bash
git pull
docker compose build
docker compose --profile migrate run --rm migrate
docker compose up -d
```

Consejo: descarga un respaldo (o encola uno manual) antes de actualizar. La
documentación de `/docs` se actualiza sola con el `git pull`.
