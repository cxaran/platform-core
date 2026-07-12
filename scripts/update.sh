#!/usr/bin/env bash
# Actualización de producción de Platform Core — segura y sin dejar basura.
#
# Flujo (modo normal, imágenes publicadas por CI en GHCR):
#   1. Preflight: repo limpio, muestra los commits entrantes y pide confirmación.
#   2. Respaldo pre-update LOCAL (pg_dump -Fc, rotado: se conservan 3).
#   3. git pull --ff-only  (compose, migraciones, docs).
#   4. Espera/descarga las imágenes del commit (tag sha-<corto>, construidas por CI).
#   5. Ventana breve: stop backend+tareas → migraciones → up -d.
#   6. Verificación: healthcheck + alembic en head.
#   7. Higiene: poda de imágenes viejas (se conservan las 3 últimas por servicio).
#
# Uso:
#   ./scripts/update.sh                  actualización normal (pull de GHCR)
#   ./scripts/update.sh --build          construye localmente (sin registry/CI)
#   ./scripts/update.sh --no-stop        sin ventana (solo migraciones compatibles)
#   ./scripts/update.sh --skip-backup    omite el dump pre-update (no recomendado)
#   ./scripts/update.sh --rollback TAG   vuelve a un tag previo (p. ej. sha-a1b2c3d)
#   ./scripts/update.sh --yes            sin confirmaciones (automatización)
set -euo pipefail

cd "$(dirname "$0")/.."

REGISTRY_PREFIX="ghcr.io/cxaran/platform-core"
IMAGES=(backend frontend model-gateway)
BACKUP_DIR="backups-preupdate"
KEEP_PREUPDATE_DUMPS=3
KEEP_IMAGE_TAGS=3

MODE="pull"
DO_STOP=1
DO_BACKUP=1
ASSUME_YES=0
ROLLBACK_TAG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --build) MODE="build"; shift ;;
    --no-stop) DO_STOP=0; shift ;;
    --skip-backup) DO_BACKUP=0; shift ;;
    --rollback) ROLLBACK_TAG="${2:?falta el tag}"; shift 2 ;;
    --yes) ASSUME_YES=1; shift ;;
    *) echo "Opción desconocida: $1"; exit 1 ;;
  esac
done

[ -f .env ] || { echo "No hay .env (¿estás en el servidor del stack?)." >&2; exit 1; }
command -v docker >/dev/null || { echo "Docker no está instalado." >&2; exit 1; }

confirm() {
  [ "$ASSUME_YES" -eq 1 ] && return 0
  printf "%s [s/N] " "$1"; read -r ok
  case "$ok" in s|S|si|SI|sí) return 0 ;; *) echo "Cancelado."; exit 1 ;; esac
}

set_image_tag() {
  # Persiste IMAGE_TAG en el .env: el tag DESPLEGADO queda registrado y cualquier
  # `docker compose up -d` posterior usa exactamente esas imágenes.
  if grep -qE '^IMAGE_TAG=' .env; then
    sed -i.bak "s|^IMAGE_TAG=.*|IMAGE_TAG=$1|" .env && rm -f .env.bak
  else
    printf '\n# Tag de imágenes desplegado (lo gestiona scripts/update.sh).\nIMAGE_TAG=%s\n' "$1" >> .env
  fi
}

wait_healthy() {
  local service="$1" tries="$2" i
  for i in $(seq 1 "$tries"); do
    if docker compose ps "$service" 2>/dev/null | grep -q "(healthy)"; then return 0; fi
    sleep 3
  done
  echo "✗ '$service' no llegó a estado sano:" >&2
  docker compose ps "$service" >&2 || true
  docker compose logs --tail 30 "$service" >&2 || true
  return 1
}

pre_update_dump() {
  [ "$DO_BACKUP" -eq 1 ] || { echo "→ (respaldo pre-update OMITIDO por --skip-backup)"; return 0; }
  mkdir -p "$BACKUP_DIR"
  local stamp file
  stamp="$(date +%Y%m%d-%H%M%S)"
  file="$BACKUP_DIR/pre-update-${stamp}.dump"
  echo "→ Respaldo pre-update local: ${file}"
  # pg_dump corre DENTRO del backend actual (trae el cliente y la red de la BD).
  docker compose exec -T backend sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -Fc -h "$POSTGRES_SERVER" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
    > "$file"
  [ -s "$file" ] || { echo "✗ El dump quedó vacío; abortando." >&2; rm -f "$file"; exit 1; }
  echo "   $(du -h "$file" | cut -f1) — restaurable con scripts/restore.sh"
  # Rotación: conserva los N más recientes.
  ls -1t "$BACKUP_DIR"/pre-update-*.dump 2>/dev/null | tail -n +$((KEEP_PREUPDATE_DUMPS + 1)) | xargs -r rm -f
}

image_available() {
  docker manifest inspect "${REGISTRY_PREFIX}-backend:$1" >/dev/null 2>&1
}

pull_images_for() {
  local tag="$1" tries="${2:-30}" i
  echo "→ Buscando imágenes ${tag} en GHCR (las publica el CI al terminar)…"
  for i in $(seq 1 "$tries"); do
    if image_available "$tag"; then
      set_image_tag "$tag"
      docker compose pull backend frontend model-gateway
      return 0
    fi
    [ "$i" -eq 1 ] && echo "   Aún no publicadas; esperando al CI (reintento cada 30 s)…"
    sleep 30
  done
  echo "✗ Las imágenes ${tag} no aparecieron. ¿CI en rojo? Revisa Actions, o usa --build." >&2
  return 1
}

apply_window() {
  if [ "$DO_STOP" -eq 1 ]; then
    echo "→ Ventana de mantenimiento: deteniendo API y tareas…"
    docker compose stop backend taskiq-worker taskiq-scheduler 2>/dev/null || true
  else
    echo "→ (--no-stop: migrando con la app en marcha — solo para migraciones compatibles)"
  fi
  echo "→ Aplicando migraciones…"
  docker compose --profile migrate run --rm migrate
  echo "→ Levantando el stack actualizado…"
  docker compose up -d
}

verify() {
  echo "→ Verificando…"
  wait_healthy backend 40
  if ! docker compose exec -T backend alembic -c backend/alembic.ini current 2>/dev/null | grep -q "(head)"; then
    echo "✗ La base NO está en la última migración (alembic current sin '(head)')." >&2
    return 1
  fi
  echo "   ✔ API sana y esquema en head."
}

cleanup_images() {
  echo "→ Higiene de disco…"
  local before after repo
  before="$(docker system df --format '{{.Type}}: {{.Size}} ({{.Reclaimable}} recuperable)' 2>/dev/null | head -2 | tr '\n' ' | ')"
  # Imágenes sha-* antiguas de nuestros servicios: se conservan las N más recientes.
  for repo in "${IMAGES[@]}"; do
    docker images "${REGISTRY_PREFIX}-${repo}" --format '{{.Tag}} {{.CreatedAt}}' \
      | grep '^sha-' | sort -k2 -r | awk '{print $1}' \
      | tail -n +$((KEEP_IMAGE_TAGS + 1)) \
      | xargs -r -I{} docker rmi "${REGISTRY_PREFIX}-${repo}:{}" 2>/dev/null || true
  done
  docker image prune -f >/dev/null
  if [ "$MODE" = "build" ]; then
    # Solo cuando se construye en el servidor: el caché de BuildKit crece sin límite.
    docker builder prune -f --filter "until=168h" >/dev/null 2>&1 || true
  fi
  after="$(docker system df --format '{{.Type}}: {{.Size}} ({{.Reclaimable}} recuperable)' 2>/dev/null | head -2 | tr '\n' ' | ')"
  echo "   antes:   ${before}"
  echo "   después: ${after}"
}

# ------------------------------------------------------------------- rollback ----
if [ -n "$ROLLBACK_TAG" ]; then
  echo "== ROLLBACK a ${ROLLBACK_TAG} =="
  image_available "$ROLLBACK_TAG" || docker images "${REGISTRY_PREFIX}-backend" --format '{{.Tag}}' | grep -qx "$ROLLBACK_TAG" \
    || { echo "✗ No existe ese tag ni en GHCR ni localmente."; exit 1; }
  echo "⚠ El rollback cambia el CÓDIGO, no el esquema: si el update aplicó migraciones,"
  echo "  restaura antes el dump pre-update (scripts/restore.sh --to-production …)."
  confirm "¿Continuar con el rollback de imágenes?"
  set_image_tag "$ROLLBACK_TAG"
  docker compose pull backend frontend model-gateway 2>/dev/null || true
  docker compose stop backend taskiq-worker taskiq-scheduler 2>/dev/null || true
  docker compose up -d
  wait_healthy backend 40
  echo "✔ Rollback aplicado (IMAGE_TAG=${ROLLBACK_TAG})."
  exit 0
fi

# --------------------------------------------------------------------- update ----
echo "== Platform Core — actualización =="

# 1) Preflight de git.
if [ -n "$(git status --porcelain)" ]; then
  echo "✗ El repo tiene cambios locales; en el servidor debe estar limpio." >&2
  git status --short >&2
  exit 1
fi
git fetch origin
CURRENT_SHA="$(git rev-parse --short=7 HEAD)"
INCOMING="$(git log --oneline HEAD..origin/main | head -20)"
if [ -z "$INCOMING" ]; then
  echo "Ya estás en la última versión (${CURRENT_SHA})."
  exit 0
fi
echo "Cambios entrantes:"
echo "$INCOMING" | sed 's/^/   /'
confirm "¿Actualizar?"

# 2) Respaldo pre-update.
pre_update_dump

# 3) Código (compose, migraciones, docs).
echo "→ git pull --ff-only…"
git pull --ff-only origin main
NEW_SHA="$(git rev-parse --short=7 HEAD)"

# 4) Imágenes.
if [ "$MODE" = "build" ]; then
  set_image_tag "sha-${NEW_SHA}"
  echo "→ Construyendo imágenes localmente (sha-${NEW_SHA})…"
  docker compose build
else
  pull_images_for "sha-${NEW_SHA}"
fi

# 5) Ventana + migraciones + arranque.
apply_window

# 6) Verificación (si falla: el dump y --rollback están a un comando).
verify || {
  echo "✗ Verificación fallida. Opciones:" >&2
  echo "   ./scripts/update.sh --rollback sha-${CURRENT_SHA}" >&2
  echo "   scripts/restore.sh --to-production ${BACKUP_DIR}/pre-update-*.dump (si hubo migraciones)" >&2
  exit 1
}

# 7) Higiene.
cleanup_images

echo
echo "=============================================================="
echo " ✔ Actualización ${CURRENT_SHA} → ${NEW_SHA} completada."
docker compose ps --format '   {{.Service}}: {{.Status}}' | sed 's/ (healthy)/ ✔/'
echo
echo " Rollback disponible: ./scripts/update.sh --rollback sha-${CURRENT_SHA}"
echo "=============================================================="