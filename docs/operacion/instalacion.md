# Instalación

La instalación reduce el conocimiento requerido a: **instalar Docker, correr un
script y seguir el asistente en el navegador**.

## Requisitos

- Docker (con Docker Compose v2) y `openssl` en el servidor.
- Un dominio público con HTTPS apuntando al servidor (recomendado; en pruebas
  locales se puede usar `http://localhost`).

## Pasos

```bash
git clone <repositorio>
cd platform-core
./scripts/install.sh https://tu-dominio.com
```

El instalador:

1. Genera el `.env` de producción con **todos los secretos aleatorios** (nunca
   sobreescribe uno existente).
2. Imprime el **token de Bootstrap una sola vez** — guárdalo: protege el
   asistente inicial.
3. Levanta el stack (`docker compose up -d`) y aplica las migraciones.

Después abre `https://tu-dominio.com/setup` e introduce el token: el asistente
crea la cuenta administradora y las decisiones iniciales (registro público,
nombre de la institución, dominio).

!!! note "Todo lo demás se configura desde la interfaz"
    Correo saliente, respaldos a Google Drive, verificación de inicio de sesión,
    login con Google, zona horaria, marca de la PWA y el copiloto se configuran
    **autenticado y auditado desde la UI** — sin editar archivos. Ver
    [puesta en marcha](../producto/puesta-en-marcha.md).

## Servicios del stack

| Servicio | Rol |
| --- | --- |
| `nginx` | Único puerto expuesto; enruta `/api/`, `/docs/`, `/model-gateway/` y el frontend en un solo origen. |
| `backend` | FastAPI (datos, RBAC, contrato de recursos). |
| `frontend` | Next.js (interfaz dirigida por contrato). |
| `model-gateway` | Runtime del copiloto (provider-neutral; nunca ve datos del negocio). |
| `docs` | Este sitio (MkDocs Material con recarga automática). |
| `redis` | Rate limiting y tokens efímeros. |
| `migrate` | Migraciones Alembic (perfil opt-in `migrate`). |
| `taskiq-worker/scheduler` | Tareas en segundo plano (perfil opt-in `taskiq`). |

PostgreSQL se asume **gestionado externamente** en producción (el compose de
desarrollo sí lo incluye).

## Actualización

```bash
git pull
docker compose build
docker compose --profile migrate run --rm migrate
docker compose up -d
```

La documentación de `/docs` se actualiza sola con el `git pull` (el servicio
`docs` reconstruye al detectar cambios).
