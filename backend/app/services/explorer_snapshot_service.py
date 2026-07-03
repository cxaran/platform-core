"""Artefacto de EXPLORACIÓN por respaldo: SQLite legible del mismo snapshot.

Construye una base SQLite con TODOS los datos legibles de la base PostgreSQL
(pacientes, consultas, notas, recetas, históricos, JSON, arrays, relaciones…) leyendo
el MISMO snapshot exportado que usa el dump restaurable — ambos artefactos representan
el mismo instante. El descubrimiento es 100% dinámico desde el catálogo de PostgreSQL:
este módulo NO importa modelos clínicos, ResourceDefinition ni RESOURCE_REGISTRY, así
que exporta también tablas/columnas históricas que el código actual ya no modele.

Excluye únicamente lo binario y lo sensible (bytea/oid, contraseñas, tokens, secretos,
ciphertexts), las tablas de sistema, alembic_version y las tablas técnicas de Taskiq.
NO anonimiza: nombres, notas y texto clínico legible se exportan completos (el
artefacto se cifra con el mismo recipient del respaldo cuando hay cifrado).

Este servicio NO cifra, NO sube a Drive, NO ejecuta pg_dump y NO toca backup_runs:
sólo construye y valida el archivo SQLite. La integración vive en BackupService.
"""

import base64
import hashlib
import json
import logging
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from decimal import Decimal
from enum import Enum
from pathlib import Path
from typing import Any

logger = logging.getLogger("backend.backups")

EXPLORER_FORMAT_VERSION = 1
EXPLORER_POLICY_VERSION = 1

_BATCH_SIZE = 1000

SYSTEM_SCHEMAS = {
    "pg_catalog",
    "information_schema",
    "pg_toast",
}

SKIPPED_TABLE_PREFIXES = (
    "taskiq_",
    "platform_core_taskiq_",
)

SKIPPED_TABLE_NAMES = {
    "alembic_version",
}

# Coincidencia por SUBSTRING sobre el nombre normalizado: cubre hashed_password,
# drive_refresh_token_ciphertext, age_identity_ciphertext, api_key, etc.
SENSITIVE_COLUMN_TOKENS = {
    "password",
    "password_hash",
    "password_digest",
    "secret",
    "token",
    "refresh_token",
    "access_token",
    "credential",
    "api_key",
    "private_key",
    "client_secret",
    "ciphertext",
    "encryption_key",
    "session_key",
}

BINARY_POSTGRES_TYPES = {
    "bytea",
    "oid",
}


def is_sensitive_column(name: str) -> bool:
    normalized = name.strip().lower()
    return any(token in normalized for token in SENSITIVE_COLUMN_TOKENS)


def is_excluded_table(schema: str, table: str) -> bool:
    if schema in SYSTEM_SCHEMAS:
        return True
    if table in SKIPPED_TABLE_NAMES:
        return True
    return table.startswith(SKIPPED_TABLE_PREFIXES)


def is_excluded_column(name: str, udt_name: str) -> bool:
    return udt_name.lower() in BINARY_POSTGRES_TYPES or is_sensitive_column(name)


def sqlite_table_name(schema: str, table: str) -> str:
    """Identificador SQLite ESTABLE y seguro por tabla: ``t_<hash corto>`` del nombre
    calificado (los nombres PostgreSQL nunca se usan como identificadores SQLite)."""
    digest = hashlib.sha256(f"{schema}.{table}".encode("utf-8")).hexdigest()[:8]
    return f"t_{digest}"


def sqlite_column_name(ordinal: int) -> str:
    """Identificador SQLite por columna: ``c_<posición>`` (mapeo en ``__mp_columns``)."""
    return f"c_{ordinal:03d}"


def to_sqlite_value(value: object) -> object:
    """Convierte un valor PostgreSQL a su representación SQLite (ver política).

    ``bytes`` nunca debe llegar (la columna se excluye antes); si llegara por un tipo
    exótico, se representa de forma segura como marcador sin contenido.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, (int, float, str)):
        return value
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    if isinstance(value, (date, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if isinstance(value, Enum):
        return str(value.value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return "<binario excluido>"
    return str(value)


def record_key_from_pk(pk_values: dict[str, object]) -> str:
    """``__mp_record_key`` para filas con primary key: base64url del JSON canónico de
    los valores de la PK (funciona con PKs simples, compuestas y no-UUID)."""
    canonical = json.dumps(
        {key: to_sqlite_value(value) for key, value in pk_values.items()},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return base64.urlsafe_b64encode(canonical.encode("utf-8")).decode("ascii").rstrip("=")


@dataclass(frozen=True)
class ColumnInfo:
    name: str
    udt_name: str
    ordinal: int
    nullable: bool


@dataclass(frozen=True)
class TableInfo:
    schema: str
    name: str
    columns: tuple[ColumnInfo, ...]
    primary_key: tuple[str, ...]

    @property
    def key(self) -> str:
        return f"{self.schema}.{self.name}"


@dataclass(frozen=True)
class RelationInfo:
    constraint_name: str
    source_key: str
    source_columns: tuple[str, ...]
    target_key: str
    target_columns: tuple[str, ...]


@dataclass(frozen=True)
class ExplorerSnapshotResult:
    output_path: Path
    table_count: int
    row_count: int
    policy_version: int


class ExplorerSnapshotError(Exception):
    """Fallo al construir el explorer. Resumen SEGURO (sin SQL, DSN ni datos)."""

    def __init__(self, code: str, summary: str) -> None:
        super().__init__(summary)
        self.code = code
        self.summary = summary


class ExplorerSnapshotService:
    """Construye el SQLite de exploración desde un snapshot PostgreSQL importado."""

    def build(
        self,
        *,
        source_dsn: str,
        snapshot_id: str,
        output_path: Path,
        backup_run_id: uuid.UUID,
    ) -> ExplorerSnapshotResult:
        import psycopg
        from psycopg import sql

        # autocommit=True para poder emitir el BEGIN manual (psycopg v3 abriría una
        # transacción implícita en el primer execute).
        with psycopg.connect(source_dsn, autocommit=True) as source:
            with source.cursor() as cursor:
                # NADA se consulta antes de importar el snapshot: el esquema y los
                # datos deben ser los del MISMO instante que el dump restaurable.
                cursor.execute(
                    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"
                )
                cursor.execute(
                    sql.SQL("SET TRANSACTION SNAPSHOT {}").format(sql.Literal(snapshot_id))
                )
            try:
                tables = self._discover_tables(source)
                relations = self._discover_relations(source, {t.key for t in tables})
                result = self._write_sqlite(
                    source=source,
                    tables=tables,
                    relations=relations,
                    output_path=output_path,
                    backup_run_id=backup_run_id,
                )
            finally:
                source.rollback()
        return result

    # -- Descubrimiento (pg_catalog / information_schema; sin ORM) -----------------

    def _discover_tables(self, source: Any) -> list[TableInfo]:
        with source.cursor() as cursor:
            cursor.execute(
                """
                SELECT table_schema, table_name
                FROM information_schema.tables
                WHERE table_type = 'BASE TABLE'
                ORDER BY table_schema, table_name
                """
            )
            candidates = [
                (schema, table)
                for schema, table in cursor.fetchall()
                if not is_excluded_table(schema, table)
            ]

            tables: list[TableInfo] = []
            for schema, table in candidates:
                cursor.execute(
                    """
                    SELECT column_name, udt_name, ordinal_position, is_nullable
                    FROM information_schema.columns
                    WHERE table_schema = %s AND table_name = %s
                    ORDER BY ordinal_position
                    """,
                    (schema, table),
                )
                columns = tuple(
                    ColumnInfo(
                        name=name,
                        udt_name=udt,
                        ordinal=ordinal,
                        nullable=(nullable == "YES"),
                    )
                    for name, udt, ordinal, nullable in cursor.fetchall()
                )

                cursor.execute(
                    """
                    SELECT att.attname
                    FROM pg_constraint con
                    JOIN unnest(con.conkey) WITH ORDINALITY AS pk(attnum, ord) ON true
                    JOIN pg_class rel ON rel.oid = con.conrelid
                    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
                    JOIN pg_attribute att
                        ON att.attrelid = con.conrelid AND att.attnum = pk.attnum
                    WHERE con.contype = 'p' AND ns.nspname = %s AND rel.relname = %s
                    ORDER BY pk.ord
                    """,
                    (schema, table),
                )
                primary_key = tuple(row[0] for row in cursor.fetchall())
                tables.append(
                    TableInfo(
                        schema=schema, name=table, columns=columns, primary_key=primary_key
                    )
                )
        return tables

    def _discover_relations(
        self, source: Any, included_keys: set[str]
    ) -> list[RelationInfo]:
        """Relaciones EXCLUSIVAMENTE desde foreign keys reales (nunca inferidas por
        nombre). ``included_keys`` decide después la navegabilidad."""
        with source.cursor() as cursor:
            cursor.execute(
                """
                SELECT con.conname,
                       ns.nspname, rel.relname,
                       fns.nspname, frel.relname,
                       att.attname, fatt.attname,
                       sk.ord
                FROM pg_constraint con
                JOIN unnest(con.conkey) WITH ORDINALITY AS sk(attnum, ord) ON true
                JOIN unnest(con.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = sk.ord
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace ns ON ns.oid = rel.relnamespace
                JOIN pg_class frel ON frel.oid = con.confrelid
                JOIN pg_namespace fns ON fns.oid = frel.relnamespace
                JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = sk.attnum
                JOIN pg_attribute fatt ON fatt.attrelid = con.confrelid AND fatt.attnum = fk.attnum
                WHERE con.contype = 'f'
                  AND ns.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                ORDER BY con.conname, ns.nspname, rel.relname, sk.ord
                """
            )
            grouped: dict[tuple[str, str, str], dict[str, Any]] = {}
            for (
                conname,
                schema,
                table,
                fschema,
                ftable,
                source_col,
                target_col,
                _ord,
            ) in cursor.fetchall():
                bucket = grouped.setdefault(
                    (conname, f"{schema}.{table}", f"{fschema}.{ftable}"),
                    {"source": [], "target": []},
                )
                bucket["source"].append(source_col)
                bucket["target"].append(target_col)

        relations: list[RelationInfo] = []
        for (conname, source_key, target_key), cols in sorted(grouped.items()):
            relations.append(
                RelationInfo(
                    constraint_name=conname,
                    source_key=source_key,
                    source_columns=tuple(cols["source"]),
                    target_key=target_key,
                    target_columns=tuple(cols["target"]),
                )
            )
        # Ruido fuera: sólo relaciones cuyo ORIGEN está incluido (el destino puede no
        # estarlo; en ese caso la relación queda registrada pero no navegable).
        return [r for r in relations if r.source_key in included_keys]

    # -- Construcción del SQLite ---------------------------------------------------

    def _write_sqlite(
        self,
        *,
        source: Any,
        tables: list[TableInfo],
        relations: list[RelationInfo],
        output_path: Path,
        backup_run_id: uuid.UUID,
    ) -> ExplorerSnapshotResult:
        if output_path.exists():
            output_path.unlink()
        db = sqlite3.connect(str(output_path))
        total_rows = 0
        try:
            db.execute("PRAGMA journal_mode=DELETE")
            db.execute("PRAGMA foreign_keys=OFF")
            self._create_meta_tables(db, backup_run_id)

            included_keys = {t.key for t in tables}
            for table in tables:
                visible = [
                    c for c in table.columns if not is_excluded_column(c.name, c.udt_name)
                ]
                t_name = sqlite_table_name(table.schema, table.name)

                # Metadata de columnas (TODAS: las excluidas quedan registradas como
                # no visibles, para que la interfaz futura explique los huecos).
                fk_source_columns = {
                    col
                    for rel in relations
                    if rel.source_key == table.key
                    for col in rel.source_columns
                }
                for column in table.columns:
                    db.execute(
                        "INSERT INTO __mp_columns VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            table.key,
                            column.name,
                            sqlite_column_name(column.ordinal),
                            column.udt_name,
                            column.ordinal,
                            1 if column.name in table.primary_key else 0,
                            1 if column.name in fk_source_columns else 0,
                            1 if column in visible else 0,
                        ),
                    )

                # Tabla de datos: __mp_record_key + una columna posicional por columna
                # visible. Los datos clínicos van aquí, nunca en las tablas __mp_*.
                column_defs = ", ".join(
                    f"{sqlite_column_name(c.ordinal)} TEXT" for c in visible
                )
                db.execute(
                    f"CREATE TABLE {t_name} (__mp_record_key TEXT PRIMARY KEY"
                    + (f", {column_defs}" if column_defs else "")
                    + ")"
                )

                row_count = self._copy_table(
                    source=source, db=db, table=table, visible=visible, t_name=t_name
                )
                total_rows += row_count

                db.execute(
                    "INSERT INTO __mp_tables VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        table.key,
                        t_name,
                        table.schema,
                        table.name,
                        row_count,
                        json.dumps(list(table.primary_key)),
                    ),
                )

                # Índices mínimos: el PRIMARY KEY de __mp_record_key ya indexa; se
                # indexa además cada columna origen de FK visible (navegación).
                visible_names = {c.name for c in visible}
                by_name = {c.name: c for c in visible}
                for rel in relations:
                    if rel.source_key != table.key:
                        continue
                    for col in rel.source_columns:
                        if col in visible_names:
                            db.execute(
                                f"CREATE INDEX IF NOT EXISTS ix_{t_name}_{sqlite_column_name(by_name[col].ordinal)} "
                                f"ON {t_name} ({sqlite_column_name(by_name[col].ordinal)})"
                            )

            # Relaciones: navegable sólo cuando origen, destino y TODAS las columnas
            # de ambos lados quedaron incluidas/visibles.
            visible_by_table = {
                t.key: {
                    c.name for c in t.columns if not is_excluded_column(c.name, c.udt_name)
                }
                for t in tables
            }
            for rel in relations:
                navigable = (
                    rel.source_key in included_keys
                    and rel.target_key in included_keys
                    and all(c in visible_by_table.get(rel.source_key, set()) for c in rel.source_columns)
                    and all(c in visible_by_table.get(rel.target_key, set()) for c in rel.target_columns)
                )
                db.execute(
                    "INSERT INTO __mp_relations VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        rel.source_key,
                        json.dumps(list(rel.source_columns)),
                        rel.target_key,
                        json.dumps(list(rel.target_columns)),
                        rel.constraint_name,
                        1 if navigable else 0,
                    ),
                )

            db.commit()
            db.execute("VACUUM")
            check = db.execute("PRAGMA integrity_check").fetchone()
            if check is None or check[0] != "ok":
                raise ExplorerSnapshotError(
                    "explorer_integrity_check_failed",
                    "El SQLite de exploración no pasó la verificación de integridad.",
                )
        except ExplorerSnapshotError:
            db.close()
            output_path.unlink(missing_ok=True)
            raise
        except Exception as error:
            db.close()
            output_path.unlink(missing_ok=True)
            raise ExplorerSnapshotError(
                "explorer_build_failed",
                "No se pudo construir el artefacto de exploración.",
            ) from error
        db.close()
        return ExplorerSnapshotResult(
            output_path=output_path,
            table_count=len(tables),
            row_count=total_rows,
            policy_version=EXPLORER_POLICY_VERSION,
        )

    def _create_meta_tables(self, db: sqlite3.Connection, backup_run_id: uuid.UUID) -> None:
        db.execute("CREATE TABLE __mp_meta (key TEXT PRIMARY KEY, value TEXT)")
        db.execute(
            "CREATE TABLE __mp_tables ("
            "table_key TEXT PRIMARY KEY, sqlite_table_name TEXT, schema_name TEXT, "
            "source_table_name TEXT, row_count INTEGER, primary_key_columns_json TEXT)"
        )
        db.execute(
            "CREATE TABLE __mp_columns ("
            "table_key TEXT, source_column_name TEXT, sqlite_column_name TEXT, "
            "source_type TEXT, ordinal_position INTEGER, is_primary_key INTEGER, "
            "is_foreign_key INTEGER, is_visible INTEGER)"
        )
        db.execute(
            "CREATE TABLE __mp_relations ("
            "source_table_key TEXT, source_columns_json TEXT, target_table_key TEXT, "
            "target_columns_json TEXT, constraint_name TEXT, is_navigable INTEGER)"
        )
        meta = {
            "format_version": str(EXPLORER_FORMAT_VERSION),
            "policy_version": str(EXPLORER_POLICY_VERSION),
            "backup_run_id": str(backup_run_id),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        db.executemany("INSERT INTO __mp_meta VALUES (?, ?)", list(meta.items()))

    def _copy_table(
        self,
        *,
        source: Any,
        db: sqlite3.Connection,
        table: TableInfo,
        visible: list[ColumnInfo],
        t_name: str,
    ) -> int:
        """Copia por LOTES (fetchmany, nunca la tabla completa en memoria) con SELECT
        explícito de columnas permitidas e identificadores construidos con
        ``psycopg.sql.Identifier`` (jamás interpolación)."""
        from psycopg import sql

        pk_columns = list(table.primary_key)
        # Se seleccionan las visibles + las PK no visibles (sólo para la record key;
        # las PK sensibles/binarias no se escriben como columnas de datos).
        select_names = [c.name for c in visible]
        extra_pk = [name for name in pk_columns if name not in set(select_names)]
        all_names = select_names + extra_pk
        if not all_names:
            return 0

        query = sql.SQL("SELECT {fields} FROM {schema}.{table}").format(
            fields=sql.SQL(", ").join(sql.Identifier(name) for name in all_names),
            schema=sql.Identifier(table.schema),
            table=sql.Identifier(table.name),
        )
        placeholders = ", ".join(["?"] * (1 + len(visible)))
        insert = f"INSERT INTO {t_name} VALUES ({placeholders})"
        name_index = {name: position for position, name in enumerate(all_names)}

        row_count = 0
        sequence = 0
        with source.cursor() as cursor:
            cursor.execute(query)
            while True:
                batch = cursor.fetchmany(_BATCH_SIZE)
                if not batch:
                    break
                converted: list[tuple[object, ...]] = []
                for row in batch:
                    if pk_columns:
                        record_key = record_key_from_pk(
                            {name: row[name_index[name]] for name in pk_columns}
                        )
                    else:
                        sequence += 1
                        record_key = f"row:{sequence}"
                    converted.append(
                        (
                            record_key,
                            *(
                                to_sqlite_value(row[name_index[c.name]])
                                for c in visible
                            ),
                        )
                    )
                db.executemany(insert, converted)
                row_count += len(converted)
        return row_count


explorer_snapshot_service = ExplorerSnapshotService()
