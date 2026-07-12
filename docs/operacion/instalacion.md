# Instalación

Despliegue de producción en un VPS **desde cero**: un solo script hace todo el
camino y termina con la API sana y el token del asistente en pantalla.

## Requisitos

- Un VPS con **Docker (Compose v2)** y `openssl`.
- El servidor sirve **HTTP**; el HTTPS público lo pone tu **túnel o proxy
  externo**: Cloudflare Tunnel corriendo en el mismo servidor, o un
  balanceador/CDN (ALB, CloudFront…) que termina TLS y reenvía al puerto del
  stack.

## Instalar

```bash
git clone <repositorio>
cd platform-core
./scripts/install.sh
```

El instalador pregunta solo dos cosas y hace el resto:

**1 · Acceso público** — dos modos:

| Modo | Qué hace |
| --- | --- |
| **Dominio HTTPS vía túnel/proxy externo** (producción) | Pide el dominio público (`https://…`) y el puerto HTTP local del stack. Si el túnel corre en **este mismo servidor** (Cloudflare Tunnel), el stack queda solo en `127.0.0.1:<puerto>` — nada expuesto a la red; si el proxy es **externo** (ALB…), escucha en el puerto para tu balanceador (protégelo por firewall/SG). |
| Solo pruebas HTTP | Modo *staging* sin dominio. ⚠ No usar con datos reales (las cookies seguras de producción exigen HTTPS en el navegador). |

Ejemplo con Cloudflare Tunnel en el mismo servidor (puerto 8088):

```yaml
# config.yml del túnel
ingress:
  - hostname: plataforma.miempresa.com
    service: http://127.0.0.1:8088
  - service: http_status:404
```

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
| `nginx` | Enrutador de origen único (`/api/`, `/docs/`, `/model-gateway/`, frontend) — el túnel/proxy externo apunta a su puerto | siempre |
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
./scripts/update.sh
```

Respaldo pre-update, pull del código, imágenes del CI, migraciones en una
ventana breve, verificación e higiene de disco — ver
[actualización](actualizacion.md).
