#!/usr/bin/env bash
# Restauración de un respaldo de Platform Core (y SIMULACRO de restauración).
#
# Un respaldo sin restauración probada es una hipótesis, no un respaldo. Este script
# restaura un archivo del pipeline (tar con database.dump, opcionalmente cifrado .age)
# usando las MISMAS herramientas de la imagen del backend (age + pg_restore): no exige
# nada instalado en el host más que Docker y el stack levantado.
#
# Uso:
#   ./scripts/restore.sh <archivo.tar | archivo.tar.age> [opciones]
#
# Opciones:
#   --identity <archivo>   Clave PRIVADA de age (obligatoria si el respaldo es .age).
#   --db <nombre>          Base de datos destino. Default: ${POSTGRES_DB}_drill
#                          (SIMULACRO: nunca toca producción por accidente).
#   --to-production        Restaura SOBRE la base de producción (POSTGRES_DB).
#                          Pide escribir el nombre exacto de la base para confirmar.
#   --yes                  Omite la confirmación del simulacro (no aplica a producción).
#
# Simulacro recomendado (documentado en docs/operacion/respaldos.md):
#   ./scripts/restore.sh respaldo-2026-07-12.tar.age --identity clave-age.txt
#   → restaura a <POSTGRES_DB>_drill y reporta un conteo de tablas como verificación.
set -euo pipefail

cd "$(dirname "$0")/.."

SERVICE="backend"
ARCHIVE="${1:-}"
IDENTITY=""
TARGET_DB=""
TO_PRODUCTION=0
ASSUME_YES=0

if [ -z "$ARCHIVE" ] || [ "${ARCHIVE#--}" != "$ARCHIVE" ]; then
  grep '^#' "$0" | sed 's/^# \{0,1\}//' | sed -n '2,24p'
  exit 1
fi
shift

while [ $# -gt 0 ]; do
  case "$1" in
    --identity) IDENTITY="${2:?falta el archivo de identidad}"; shift 2 ;;
    --db) TARGET_DB="${2:?falta el nombre de la base}"; shift 2 ;;
    --to-production) TO_PRODUCTION=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    *) echo "Opción desconocida: $1" >&2; exit 1 ;;
  esac
done

ENV_FILE="${APP_ENV_FILE:-.env}"
COMPOSE_FILE_ARGS=()
if [ -n "${RESTORE_COMPOSE_FILE:-}" ]; then
  COMPOSE_FILE_ARGS=(-f "$RESTORE_COMPOSE_FILE")
fi
dc() { docker compose "${COMPOSE_FILE_ARGS[@]}" "$@"; }

[ -f "$ARCHIVE" ] || { echo "No existe el archivo: $ARCHIVE" >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "No hay $ENV_FILE (¿estás en el servidor del stack?)." >&2; exit 1; }

command -v docker >/dev/null || { echo "Docker no está instalado." >&2; exit 1; }
dc ps --status running "$SERVICE" 2>/dev/null | grep -q "$SERVICE" \
  || { echo "El servicio '$SERVICE' no está corriendo (docker compose up -d)." >&2; exit 1; }

# Variables de conexión desde el env del despliegue (mismas que usa la app).
db_env() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }
PGHOST="$(db_env POSTGRES_SERVER)"
PGPORT="$(db_env POSTGRES_PORT)"
PGUSER="$(db_env POSTGRES_USER)"
PGPASSWORD="$(db_env POSTGRES_PASSWORD)"
PROD_DB="$(db_env POSTGRES_DB)"

if [ "$TO_PRODUCTION" -eq 1 ]; then
  TARGET_DB="$PROD_DB"
  echo "⚠  RESTAURACIÓN SOBRE PRODUCCIÓN: se reemplazará el contenido de '$PROD_DB'."
  echo "   Detén la aplicación antes (docker compose stop backend taskiq-worker) si"
  echo "   quieres un corte limpio."
  printf "   Escribe el nombre exacto de la base para confirmar: "
  read -r CONFIRM
  [ "$CONFIRM" = "$PROD_DB" ] || { echo "Confirmación incorrecta; nada se tocó."; exit 1; }
else
  TARGET_DB="${TARGET_DB:-${PROD_DB}_drill}"
  if [ "$TARGET_DB" = "$PROD_DB" ]; then
    echo "Para restaurar sobre producción usa --to-production (confirmación explícita)." >&2
    exit 1
  fi
  if [ "$ASSUME_YES" -ne 1 ]; then
    printf "Simulacro: se restaurará en la base '%s' (se crea/reemplaza). ¿Continuar? [s/N] " "$TARGET_DB"
    read -r OK
    case "$OK" in s|S|si|SI|sí) ;; *) echo "Cancelado."; exit 1 ;; esac
  fi
fi

STAMP="$(date +%s)"
WORK="/tmp/restore-$STAMP"
BASENAME="$(basename "$ARCHIVE")"

echo "→ Copiando el archivo al contenedor…"
dc exec -T "$SERVICE" mkdir -p "$WORK"
dc cp "$ARCHIVE" "$SERVICE:$WORK/$BASENAME"

if [ -n "$IDENTITY" ]; then
  [ -f "$IDENTITY" ] || { echo "No existe la identidad age: $IDENTITY" >&2; exit 1; }
  dc cp "$IDENTITY" "$SERVICE:$WORK/identity.txt"
fi

echo "→ Restaurando dentro del contenedor (age → tar → pg_restore)…"
dc exec -T \
  -e PGPASSWORD="$PGPASSWORD" \
  -e WORK="$WORK" -e BASENAME="$BASENAME" \
  -e PGHOST="$PGHOST" -e PGPORT="$PGPORT" -e PGUSER="$PGUSER" \
  -e TARGET_DB="$TARGET_DB" -e MAINT_DB="$PROD_DB" -e TO_PRODUCTION="$TO_PRODUCTION" \
  "$SERVICE" bash -euo pipefail -c '
    cd "$WORK"
    FILE="$BASENAME"
    case "$FILE" in
      *.age)
        [ -f identity.txt ] || { echo "El respaldo está cifrado: falta --identity." >&2; exit 1; }
        age -d -i identity.txt -o payload.tar "$FILE"
        FILE=payload.tar
        ;;
    esac
    tar -xf "$FILE"
    DUMP="$(find . -name database.dump | head -1)"
    [ -n "$DUMP" ] || { echo "El archivo no contiene database.dump." >&2; exit 1; }

    # Verificación previa (la misma del pipeline): el dump debe listarse íntegro.
    pg_restore --list "$DUMP" > /dev/null

    # pg_restore sale con rc=1 ante errores IGNORADOS (p. ej. el conocido
    # "SET transaction_timeout" cuando el cliente pg_dump es más nuevo que el
    # servidor). El éxito real lo decide la VERIFICACIÓN posterior, no el rc.
    RESTORE_RC=0
    if [ "$TO_PRODUCTION" -eq 1 ]; then
      # Sobre producción: limpia y recrea objetos dentro de la MISMA base.
      pg_restore --clean --if-exists --no-owner --no-privileges \
        -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TARGET_DB" "$DUMP" || RESTORE_RC=$?
    else
      # Simulacro: base propia, recreada desde cero.
      dropdb  -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$TARGET_DB"
      createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$TARGET_DB"
      pg_restore --no-owner --no-privileges \
        -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TARGET_DB" "$DUMP" || RESTORE_RC=$?
    fi
    if [ "$RESTORE_RC" -ne 0 ]; then
      echo "⚠ pg_restore reportó errores ignorados (rc=$RESTORE_RC): revisa el listado de arriba."
    fi

    TABLES="$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TARGET_DB" -Atc \
      "select count(*) from information_schema.tables where table_schema = '"'"'public'"'"'")"
    USERS="$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TARGET_DB" -Atc \
      "select count(*) from \"user\"" 2>/dev/null || echo "n/d")"
    if [ "${TABLES:-0}" -eq 0 ]; then
      echo "✗ Verificación FALLIDA: la base '"'"'$TARGET_DB'"'"' quedó sin tablas." >&2
      exit 1
    fi
    echo "✔ Restauración completada en '"'"'$TARGET_DB'"'"': $TABLES tablas, $USERS usuarios."
    rm -rf "$WORK"
  '

if [ "$TO_PRODUCTION" -eq 1 ]; then
  echo "→ Producción restaurada. Reinicia la aplicación: docker compose up -d"
else
  echo "→ Simulacro OK. Limpieza opcional:"
  echo "   docker compose exec $SERVICE dropdb -h $PGHOST -p $PGPORT -U $PGUSER $TARGET_DB"
fi
