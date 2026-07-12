#!/usr/bin/env bash
# Instalador de Platform Core — despliegue de PRODUCCIÓN en un VPS desde cero.
#
# Hace TODO el camino: pregunta lo mínimo (dominio/TLS y base de datos), genera el
# .env con todos los secretos únicos, construye las imágenes, levanta PostgreSQL si
# elegiste el contenedor local, aplica migraciones, arranca el stack completo
# (incluidos worker y scheduler de tareas) y espera a que la API esté sana.
# Imprime el token de Bootstrap UNA sola vez al final.
#
# Todo lo demás (correo, dominio verificado, respaldos a Drive, copiloto) se
# configura DESDE LA UI, autenticado y auditado — sin volver a tocar archivos.
#
# Uso:
#   ./scripts/install.sh                 instalación interactiva completa
#   ./scripts/install.sh --resume        re-ejecuta la orquestación con el .env
#                                        existente (instalación interrumpida)
#   ./scripts/install.sh --print-env     genera y muestra un .env SIN escribirlo
#                                        ni tocar Docker (revisión previa)
#
# Requisitos del VPS: Docker con Compose v2 y openssl. Para TLS automático: un
# dominio apuntando a este servidor y los puertos 80/443 abiertos.
set -euo pipefail

cd "$(dirname "$0")/.."

MODE="install"
case "${1:-}" in
  --resume)    MODE="resume" ;;
  --print-env) MODE="print-env" ;;
  "" ) ;;
  *) echo "Opción desconocida: $1 (usa --resume o --print-env)"; exit 1 ;;
esac

command -v docker >/dev/null || { echo "Docker no está instalado."; exit 1; }
command -v openssl >/dev/null || { echo "openssl no está disponible."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Se requiere Docker Compose v2 (docker compose)."; exit 1; }

# ---------------------------------------------------------------- utilidades ----
rand_hex()    { openssl rand -hex 32; }
rand_token()  { openssl rand -base64 24 | tr '+/' '-_' | tr -d '=' ; }
# Clave Fernet válida: 32 bytes en base64 url-safe (con padding).
rand_fernet() { openssl rand 32 | openssl base64 -A | tr '+/' '-_' ; }

wait_healthy() {
  # wait_healthy <servicio> <intentos> — espera el estado (healthy) de compose ps.
  local service="$1" tries="$2" i
  for i in $(seq 1 "$tries"); do
    if docker compose ps "$service" 2>/dev/null | grep -q "(healthy)"; then
      return 0
    fi
    sleep 3
  done
  echo "✗ '$service' no llegó a estado sano. Diagnóstico:" >&2
  docker compose ps "$service" >&2 || true
  docker compose logs --tail 30 "$service" >&2 || true
  return 1
}

orchestrate() {
  # Toda la orquestación lee COMPOSE_PROFILES del .env (compose lo toma solo).
  local domain="$1"
  local profiles
  profiles="$(grep -E '^COMPOSE_PROFILES=' .env | cut -d= -f2- || true)"

  echo
  echo "→ [1/5] Construyendo imágenes (la primera vez tarda varios minutos)…"
  docker compose build

  if [[ ",$profiles," == *",db,"* ]]; then
    echo "→ [2/5] Levantando PostgreSQL local…"
    docker compose up -d postgres
    wait_healthy postgres 40
  else
    echo "→ [2/5] Base de datos externa: se asume accesible."
  fi

  echo "→ [3/5] Aplicando migraciones…"
  docker compose --profile migrate run --rm migrate

  echo "→ [4/5] Levantando el stack completo…"
  docker compose up -d

  echo "→ [5/5] Esperando a que la API esté sana…"
  wait_healthy backend 40

  local token
  token="$(grep -E '^BOOTSTRAP_SETUP_TOKEN=' .env | cut -d= -f2-)"
  echo
  echo "=============================================================="
  echo " ✔ Instalación completa. Servicios:"
  docker compose ps --format '   {{.Service}}: {{.Status}}' | sed 's/ (healthy)/ ✔/'
  echo
  echo " TOKEN DE BOOTSTRAP (guárdalo; también está en el .env):"
  echo
  echo "   ${token}"
  echo
  echo " Siguiente paso: abre ${domain}/setup e introduce el token."
  if [[ ",$profiles," == *",tls,"* ]]; then
    echo " (Caddy emite el certificado en el primer acceso: dale ~30 segundos.)"
  fi
  echo
  echo " Tras el asistente, el checklist de la app te guía para configurar"
  echo " correo, dominio verificado y respaldos — todo desde la interfaz."
  echo "=============================================================="
}

# ------------------------------------------------------------------- resume ----
if [ "$MODE" = "resume" ]; then
  [ -f .env ] || { echo "No hay .env que reanudar: corre la instalación completa."; exit 1; }
  DOMAIN="$(grep -E '^TRUSTED_BROWSER_ORIGINS=' .env | cut -d= -f2- | cut -d, -f1)"
  orchestrate "${DOMAIN:-http://localhost}"
  exit 0
fi

if [ "$MODE" = "install" ] && [ -f .env ]; then
  echo "Ya existe un .env — no se toca (usa --resume para re-orquestar, o bórralo"
  echo "conscientemente si quieres regenerar los secretos)."
  exit 1
fi

# ------------------------------------------------------------------ preguntas ----
echo "== Platform Core — instalación de producción =="
echo
echo "Acceso público (TLS):"
echo "  1) Dominio con HTTPS automático (Caddy + Let's Encrypt)  ← recomendado"
echo "  2) Detrás de MI propio proxy TLS (yo termino HTTPS)"
echo "  3) Solo pruebas por HTTP (sin dominio; modo staging)"
read -r -p "Elige [1/2/3, default 1]: " TLS_CHOICE
TLS_CHOICE="${TLS_CHOICE:-1}"

ENVIRONMENT="production"
PROFILES="taskiq"
HTTP_PORT_LINE=""
CADDY_DOMAIN=""

case "$TLS_CHOICE" in
  1)
    read -r -p "Dominio (sin https://, p. ej. plataforma.miempresa.com): " BARE_DOMAIN
    BARE_DOMAIN="${BARE_DOMAIN#https://}"; BARE_DOMAIN="${BARE_DOMAIN#http://}"; BARE_DOMAIN="${BARE_DOMAIN%/}"
    [ -n "$BARE_DOMAIN" ] || { echo "El TLS automático requiere un dominio."; exit 1; }
    DOMAIN="https://${BARE_DOMAIN}"
    CADDY_DOMAIN="$BARE_DOMAIN"
    PROFILES="${PROFILES},tls"
    # Caddy toma 80/443; nginx queda solo en el loopback del host (diagnóstico).
    HTTP_PORT_LINE="HTTP_PORT=127.0.0.1:8088"
    ;;
  2)
    read -r -p "Dominio público con https (https://…): " DOMAIN
    DOMAIN="${DOMAIN%/}"
    case "$DOMAIN" in https://*) ;; *) echo "Producción requiere https:// (cookies seguras)."; exit 1 ;; esac
    read -r -p "Puerto local donde tu proxy encontrará el stack [8080]: " LOCAL_PORT
    HTTP_PORT_LINE="HTTP_PORT=127.0.0.1:${LOCAL_PORT:-8080}"
    echo "   → Apunta tu proxy a http://127.0.0.1:${LOCAL_PORT:-8080}"
    ;;
  3)
    DOMAIN="http://localhost"
    ENVIRONMENT="staging"
    echo "   ⚠ Modo STAGING (sin https las cookies seguras de producción no funcionan)."
    echo "     No uses este modo con datos reales."
    ;;
  *) echo "Opción inválida."; exit 1 ;;
esac

echo
echo "Base de datos PostgreSQL:"
echo "  1) Contenedor local del stack (volumen Docker)  ← recomendado en un VPS"
echo "  2) Servidor externo (ingresar credenciales)"
read -r -p "Elige [1/2, default 1]: " DB_CHOICE
DB_CHOICE="${DB_CHOICE:-1}"

case "$DB_CHOICE" in
  1)
    PROFILES="db,${PROFILES}"
    PG_SERVER="postgres"; PG_PORT="5432"; PG_USER="platform"; PG_DB="platform_core"
    PG_PASSWORD="$(rand_token)"
    ;;
  2)
    read -r -p "  Host: " PG_SERVER
    read -r -p "  Puerto [5432]: " PG_PORT; PG_PORT="${PG_PORT:-5432}"
    read -r -p "  Usuario: " PG_USER
    read -r -s -p "  Contraseña: " PG_PASSWORD; echo
    read -r -p "  Base de datos [platform_core]: " PG_DB; PG_DB="${PG_DB:-platform_core}"
    [ -n "$PG_SERVER" ] && [ -n "$PG_USER" ] && [ -n "$PG_PASSWORD" ] \
      || { echo "Faltan datos de la base externa."; exit 1; }
    ;;
  *) echo "Opción inválida."; exit 1 ;;
esac

# --------------------------------------------------------------- generar .env ----
BOOTSTRAP_TOKEN="$(rand_token)"
AGENT_TICKET_SECRET="$(rand_hex)"
AGENT_INTERNAL_SECRET="$(rand_hex)"

ENV_CONTENT="$(cat <<ENV
# Generado por scripts/install.sh — secretos ÚNICOS de esta instalación.
# La política (registro, correo, respaldos, retención…) se administra desde la UI.
ENVIRONMENT=${ENVIRONMENT}
TRUSTED_BROWSER_ORIGINS=${DOMAIN}

# Perfiles de compose de ESTA instalación (docker compose los lee de aquí):
#   taskiq = tareas en segundo plano (respaldos, retención, correos de alertas)
#   db     = PostgreSQL local en contenedor      tls = HTTPS automático con Caddy
COMPOSE_PROFILES=${PROFILES}
${HTTP_PORT_LINE}

SECRET_KEY=$(rand_hex)
APP_ENCRYPTION_KEY=$(rand_fernet)
BOOTSTRAP_SETUP_TOKEN=${BOOTSTRAP_TOKEN}

ACCESS_TOKEN_EXPIRE_MINUTES=30
EMAIL_TOKEN_EXPIRE_MINUTES=30
TRYS_BEFORE_LOCK=5

POSTGRES_USER=${PG_USER}
POSTGRES_PASSWORD=${PG_PASSWORD}
POSTGRES_SERVER=${PG_SERVER}
POSTGRES_PORT=${PG_PORT}
POSTGRES_DB=${PG_DB}

REDIS_HOST=redis
REDIS_PORT=6379
REDIS_DB=0

# Copiloto (Agent Gateway): pares COMPARTIDOS backend <-> gateway, generados juntos.
AGENT_GATEWAY_TICKET_SIGNING_SECRET=${AGENT_TICKET_SECRET}
AGENT_GATEWAY_INTERNAL_SECRET=${AGENT_INTERNAL_SECRET}
GATEWAY_AGENT_TICKET_SECRET=${AGENT_TICKET_SECRET}
GATEWAY_BACKEND_INTERNAL_SECRET=${AGENT_INTERNAL_SECRET}
GATEWAY_BACKEND_INTERNAL_URL=http://backend:8000
GATEWAY_ALLOWED_ORIGINS=${DOMAIN}
# Habilita proveedores según uses: GATEWAY_OPENAI_ENABLED=true, etc.

# Transporte de correo del entorno (el modo se elige en la UI: entorno/SMTP/Resend).
# En producción el modo "entorno" exige un SMTP real (Mailpit se rechaza).
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM_EMAIL=
SMTP_FROM_NAME=Platform Core
SMTP_TLS=true
SMTP_SSL=false
SMTP_USE_CREDENTIALS=true
ENV
)"

if [ "$MODE" = "print-env" ]; then
  echo
  echo "----- .env que se generaría (NO escrito; el token cambia en la real) -----"
  echo "$ENV_CONTENT"
  exit 0
fi

umask 077
printf '%s\n' "$ENV_CONTENT" > .env
echo "→ .env generado (permisos restringidos)."

if [ -n "$CADDY_DOMAIN" ]; then
  mkdir -p caddy
  cat > caddy/Caddyfile <<CADDY
# Generado por scripts/install.sh — TLS automático para ${CADDY_DOMAIN}.
${CADDY_DOMAIN} {
	encode gzip
	reverse_proxy nginx:80
}
CADDY
  echo "→ caddy/Caddyfile generado para ${CADDY_DOMAIN}."
fi

orchestrate "$DOMAIN"
