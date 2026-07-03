#!/usr/bin/env bash
# Instalador de Platform Core (despliegue self-hosted autocontenido).
#
# Reduce el conocimiento requerido a: instalar Docker, correr este script, abrir el
# dominio y seguir el asistente. Genera el .env de producción con TODOS los secretos
# aleatorios (nunca sobreescribe uno existente) e imprime el token de Bootstrap UNA
# sola vez. Todo lo demás (correo, dominio, Google Drive/respaldos) se configura
# DESDE LA UI, autenticado y auditado — sin editar archivos.
#
# Uso:   ./scripts/install.sh [https://tu-dominio.com]
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  echo "Ya existe un .env — no se toca (bórralo o respáldalo si quieres regenerar)."
  exit 1
fi

command -v docker >/dev/null || { echo "Docker no está instalado."; exit 1; }
command -v openssl >/dev/null || { echo "openssl no está disponible."; exit 1; }

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  read -r -p "Dominio público (https://tu-dominio.com) [http://localhost]: " DOMAIN
  DOMAIN="${DOMAIN:-http://localhost}"
fi
DOMAIN="${DOMAIN%/}"

rand_hex()    { openssl rand -hex 32; }
rand_token()  { openssl rand -base64 24 | tr '+/' '-_' | tr -d '=' ; }
# Clave Fernet válida: 32 bytes en base64 url-safe (con padding).
rand_fernet() { openssl rand 32 | openssl base64 -A | tr '+/' '-_' ; }

BOOTSTRAP_TOKEN="$(rand_token)"
POSTGRES_PASSWORD="$(rand_token)"

umask 077
cat > .env <<ENV
# Generado por scripts/install.sh — secretos ÚNICOS de esta instalación.
# La política (registro, correo, respaldos) se administra desde la UI.
ENVIRONMENT=production
TRUSTED_BROWSER_ORIGINS=${DOMAIN}

SECRET_KEY=$(rand_hex)
APP_ENCRYPTION_KEY=$(rand_fernet)
BOOTSTRAP_SETUP_TOKEN=${BOOTSTRAP_TOKEN}

ACCESS_TOKEN_EXPIRE_MINUTES=30
EMAIL_TOKEN_EXPIRE_MINUTES=30
TRYS_BEFORE_LOCK=5

POSTGRES_USER=platform
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_SERVER=postgres
POSTGRES_PORT=5432
POSTGRES_DB=platform_core

REDIS_HOST=redis
REDIS_PORT=6379
REDIS_DB=0

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

echo
echo "=============================================================="
echo " .env generado (permisos restringidos)."
echo
echo " TOKEN DE BOOTSTRAP (se muestra UNA sola vez — guárdalo):"
echo
echo "   ${BOOTSTRAP_TOKEN}"
echo
echo " Siguientes pasos:"
echo "   1. docker compose build"
echo "   2. docker compose --profile migrate run --rm migrate"
echo "   3. docker compose up -d"
echo "   4. (respaldos) docker compose --profile taskiq up -d taskiq-worker taskiq-scheduler"
echo "   5. Abre ${DOMAIN}/setup y usa el token de arriba."
echo
echo " Tras el asistente: el checklist de la app te guía para configurar"
echo " correo, dominio verificado y Google Drive/respaldos — todo desde"
echo " la interfaz, sin volver a tocar archivos."
echo "=============================================================="
