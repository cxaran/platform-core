# Respaldos configurables cifrados hacia Google Drive

## Qué hace

Respaldo **diario configurable** de la base de datos PostgreSQL del consultorio,
subido a **una** cuenta de Google Drive del administrador, con retención
diaria/mensual/anual y rotación que nunca borra copias protegidas. Apagado por
defecto (`BACKUPS_ENABLED=false` y el singleton se siembra con `enabled=false`).

El **cifrado del archivo es OPCIONAL** (decisión del dueño del producto): sin
recipient de age configurado —el estado por defecto— el respaldo sube **sin cifrar**
(`.tar`); si se configura la clave pública, se cifra antes de salir (`.tar.age`).
Advertencia consciente: sin cifrar, cualquiera con acceso a la cuenta de Drive puede
leer la base clínica completa.

**La clave que abre los respaldos nunca se pierde**: la acción "Generar clave de
cifrado" crea el par age EN el sistema, guarda la identidad privada CIFRADA (Fernet)
y la envía por CORREO al administrador; además, **cada cambio de configuración**
reenvía un correo con el resumen aplicado y la clave privada (mientras el par sea del
sistema). Si el administrador pega un recipient externo, el sistema olvida la
identidad guardada (esa privada la conserva él) y el correo lo indica.

## Arquitectura en una vista

```
Taskiq scheduler ── cada minuto (cron FIJO, UTC) ──► backups.tick
                                                        │
                              PostgreSQL = fuente de verdad funcional
                              backup_settings.next_run_at   (horario editable)
                              backup_runs.next_attempt_at   (reintentos)
                                                        │
                                            sólo procesa trabajo VENCIDO
                                                        │
        pg_dump -Fc ─► pg_restore --list ─► manifest ─► tar ─► age ─► Drive
```

- **Taskiq no guarda el horario del usuario.** El tick por minuto consulta la tabla;
  cambiar hora/zona/retención o reconectar Drive **no** requiere reiniciar nada.
- El worker reclama ejecuciones con `SELECT … FOR UPDATE SKIP LOCKED` + **lease**
  (`BACKUP_RUN_LEASE_MINUTES`): dos workers no procesan el mismo respaldo y un worker
  muerto se recupera al expirar el lease.
- La API sólo **registra intenciones** (editar configuración, encolar respaldo
  manual) y su lifespan inicia el broker únicamente para *publicar* el kick del tick.

## Cifrado (dos capas, dos propósitos)

| Qué | Con qué | Dónde vive la clave |
| --- | --- | --- |
| El **archivo** del respaldo (OPCIONAL) | binario `age`, clave PÚBLICA (`age_recipient`) | La identidad privada la conserva el administrador **fuera del sistema** (jamás se acepta ni se guarda). Sin recipient: el archivo sube sin cifrar |
| El **refresh token** de Google en reposo (siempre) | Fernet (`BACKUP_TOKEN_ENCRYPTION_KEY`) | Sólo en el `.env` del despliegue; nunca en PostgreSQL |

El recipient se valida invocando `age` con entrada vacía. El archivo final es
`{prefix}-{timestampUTC}-{run8}.tar.age` (o `….tar` sin cifrar; sin plantillas
libres) y contiene
`database.dump` (pg_dump formato custom, restaurable con `pg_restore`) y
`manifest.json` (versión de formato, run id, fecha, sha del dump — **sin** datos
clínicos, usuarios, tokens ni rutas).

**Restauración (manual, fuera de la UI en esta fase):** descargar el archivo; si es
`.tar.age`, `age --decrypt -i <identidad-privada>` primero; extraer el tar y
`pg_restore` del dump.

## Google Drive

- OAuth con scope **`drive.file`** únicamente (acceso a archivos creados por la app;
  nunca a todo el Drive). `access_type=offline` + `prompt=consent` para obtener
  refresh token. El `state` se guarda **hasheado** (SHA-256), expira en 10 minutos y
  se consume una sola vez.
- Carpeta **visible** "MediCopilot Backups" creada por la app (no `appDataFolder`);
  en reconexión se valida la carpeta guardada y se crea una nueva si ya no existe.
- Subida **resumible** con `appProperties` (`medicopilot_backup_run_id` + sha256):
  si una carga terminó en Google pero la respuesta se perdió, el reintento
  **reconcilia** por run id + checksum en vez de duplicar.

## Estados y reintentos

`backup_runs.status`: `queued → running → succeeded | retrying | failed`, más
`skipped` (ventana saltada visiblemente, p. ej. Drive desconectado) y `pruned`
(archivo remoto rotado por retención; la fila del historial se conserva).

- Error **temporal** (red, 5xx/429, pg_dump caído): `retrying` con backoff
  **+5 min → +30 min**; al agotar `BACKUP_MAX_ATTEMPTS` (3) → `failed`.
- **`needs_reauth`** (Google revocó/invalidó la credencial): la ejecución falla
  terminal, `drive_status=needs_reauth` y **no hay más reintentos ni ventanas** hasta
  que el administrador reconecte. Las ventanas siguientes quedan `skipped` en el
  historial.
- Error **permanente** (configuración incompleta, recipient inválido): `failed`
  directo.
- **Alerta persistente**: todo desenlace fallido escribe
  `backup_settings.last_error_code/summary/at` (y el estado de Drive); el primer
  éxito posterior la despeja. La UI genérica del recurso la muestra — no hay centro
  de notificaciones en esta fase.

Los resúmenes de error son SEGUROS: jamás tokens, contraseñas, rutas, argumentos de
`pg_dump` ni texto crudo de Google (el detalle técnico vive sólo en logs internos).

## Artefacto de EXPLORACIÓN (opcional, `BACKUP_EXPLORER_ENABLED`)

Además del archivo restaurable, cada respaldo puede generar un **SQLite legible**
(`{prefix}-{ts}-{run}.explorer.sqlite[.age]`) construido del **mismo snapshot
PostgreSQL** que el dump (`pg_export_snapshot` + `pg_dump --snapshot` + `SET
TRANSACTION SNAPSHOT`): ambos representan exactamente el mismo instante. Pensado para
un explorador futuro de respaldos históricos.

- **Contenido**: todo lo legible, descubierto DINÁMICAMENTE del catálogo de PostgreSQL
  (sin modelos ni RESOURCE_REGISTRY: también tablas/columnas históricas). Sin
  anonimizar. JSON/arrays/UUID/fechas/enums/PKs/FKs se conservan; sólo se excluyen
  binarios (bytea/oid), columnas sensibles (password/token/secret/credential/
  ciphertext…), esquemas de sistema, `alembic_version` y tablas de Taskiq.
- **Formato interno**: identificadores seguros (`t_<hash>`, `c_<posición>`),
  `__mp_record_key` por fila (base64url del JSON canónico de la PK; `row:<n>` sin PK)
  y metadata `__mp_meta/__mp_tables/__mp_columns/__mp_relations` (relaciones sólo de
  FKs reales, con navegabilidad calculada). Validado con `PRAGMA integrity_check`.
- **Estados propios** (`explorer_status`: not_requested/building/ready/failed): un
  explorer fallido **jamás** invalida un restore correcto. Reauth de Drive marca
  `needs_reauth` (alerta persistente) sin reintentos; errores temporales de subida
  reintentan hasta 3 veces en la misma ejecución.
- **Cifrado y subida**: mismo recipient opcional de age y misma carpeta de Drive; los
  archivos se distinguen por `appProperties.medicopilot_artifact_kind`
  (`restore`/`explorer`).
- **Retención en pareja**: la rotación borra primero el explorer y sólo marca `pruned`
  cuando ambos artefactos quedaron fuera; si el borrado del explorer falla, el restore
  se conserva y la siguiente rotación reintenta.

## Retención

Cada éxito recibe roles en **fechas locales** (zona configurada): `daily` siempre;
`monthly` si es el primero exitoso de su mes; `yearly` si es el primero de su año.
Tras cada éxito se rota: se protegen los N más recientes de cada rol
(`retention_daily_count`/`monthly`/`yearly`) y sólo se borra de Drive lo que **ningún
rol** protege. Desconectar Drive nunca borra archivos remotos.

## Superficie de administración

Recursos declarativos (UI genérica existente, sin pantallas a medida):

- **`backup_settings`** (singleton editable con `backups:configure`): hora diaria,
  zona IANA, prefijo, retenciones, recipient de age (opcional), interruptor
  `enabled` (sólo se puede activar con Drive activo + carpeta + claves del
  despliegue; el recipient NO es requisito).
  Acciones: **Conectar Google Drive** (devuelve `authorization_url`; el frontend
  redirige), **Desconectar** (apaga y olvida token/carpeta; conserva historial y
  archivos), **Generar clave de cifrado** (par age del sistema; la privada viaja por
  correo y queda guardada cifrada — la API nunca la devuelve) y **Respaldar ahora**
  (encola manual y despierta el tick). Todo cambio de configuración (PATCH, conectar,
  desconectar, generar clave) envía el correo resumen al administrador.
- **`backup_runs`** (solo lectura con `backups:read`): historial con estado, origen,
  ventana, archivo, tamaño, roles de retención, intentos, error y el estado/tamaño
  del artefacto de exploración.

Callback OAuth: `GET /api/v1/backups/google-drive/callback` (exige la sesión del
administrador) → redirige a `/resources/backup_settings?drive=connected|error`.

**Archivos reales en Drive (fase inicial del explorador)**: página `/backups`
(sidebar → Respaldos, gate `backups:read`) que lista los archivos de la carpeta
conectada — nombre, tipo (Respaldo/Exploración), fecha y tamaño — con descarga en
streaming. Endpoints: `GET /api/v1/backups/drive-files` (409 legible si Drive no
está conectado o requiere reconexión) y `GET
/api/v1/backups/drive-files/{file_id}/download` (sólo sirve archivos que
pertenezcan a la carpeta configurada). Sin exploración todavía: abrir el SQLite
desde la UI llega en la fase siguiente.

## Configuración del despliegue

```env
BACKUPS_ENABLED=false            # interruptor global del tick
BACKUP_TEMP_DIR=/tmp/medicopilot-backups
BACKUP_RUN_LEASE_MINUTES=120
BACKUP_MAX_ATTEMPTS=3

GOOGLE_DRIVE_CLIENT_ID=          # app OAuth "web" de Google Cloud
GOOGLE_DRIVE_CLIENT_SECRET=      # sólo .env; nunca en PostgreSQL
GOOGLE_DRIVE_REDIRECT_URI=       # …/api/v1/backups/google-drive/callback

BACKUP_TOKEN_ENCRYPTION_KEY=     # Fernet: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

La imagen backend incluye `postgresql-client` (v17 de Debian trixie; sirve contra
el Postgres 16: pg_dump debe ser >= al servidor) y `age`;
API, worker y scheduler usan la **misma imagen** (profile `taskiq` del compose).

## Puesta en marcha

1. Configurar el `.env` (bloque de arriba) y `BACKUPS_ENABLED=true`.
2. Aplicar la migración (`docker compose --profile migrate run --rm migrate`).
3. Levantar worker y scheduler: `docker compose --profile taskiq up -d taskiq-worker taskiq-scheduler`.
4. En la UI (`/resources/backup_settings`): Conectar Google Drive (consent), ajustar
   hora/retención y activar. Opcional: pegar un **recipient público de age** si se
   quiere el respaldo cifrado.
5. Probar con **Respaldar ahora** y revisar `/resources/backup_runs`.

## Fuera de alcance de esta fase

Correos y push, centro de notificaciones, múltiples destinos/cuentas, restauración
desde UI, selección libre de carpeta (Google Picker), cron editable, respaldos
incrementales/PITR (`pg_basebackup`/WAL), `pg_dumpall` (se respalda **una** base, sin
roles globales del clúster) y schedulers dinámicos de Taskiq.
