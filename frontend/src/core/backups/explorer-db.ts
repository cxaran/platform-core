// Módulo PURO del visor de artefactos de exploración (SQLite legible por respaldo).
// Opera sobre una interfaz mínima de ejecución SQL (la implementa sql.js en el
// navegador; los tests usan un fake) y sólo conoce el CONTRATO del artefacto: las
// tablas __mp_meta/__mp_tables/__mp_columns/__mp_relations y los identificadores
// seguros t_<hash>/c_<posición> que genera el backend. Sin fetch, sin React, sin
// conocimiento del esquema del dominio: todo se descubre de la metadata del archivo.

/** Resultado de sql.js `db.exec`: columnas + filas posicionales. */
export interface ExecResult {
  columns: string[];
  values: unknown[][];
}

export type SqlExec = (sql: string) => ExecResult[];

export interface ExplorerMeta {
  formatVersion: string | null;
  policyVersion: string | null;
  backupRunId: string | null;
  createdAt: string | null;
}

export interface ExplorerTable {
  key: string;
  sqliteName: string;
  schemaName: string;
  tableName: string;
  rowCount: number;
  pkColumns: string[];
}

export interface ExplorerColumn {
  tableKey: string;
  sourceName: string;
  sqliteName: string;
  sourceType: string;
  ordinal: number;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  visible: boolean;
}

export interface ExplorerCatalog {
  meta: ExplorerMeta;
  tables: ExplorerTable[];
  columnsByTable: Map<string, ExplorerColumn[]>;
}

export const EXPLORER_PAGE_SIZE = 50;

/** ¿El nombre indica un artefacto cifrado con age (se descifra EN el navegador)? */
export function isEncryptedName(name: string): boolean {
  return name.endsWith(".age");
}

function rowsAsObjects(result: ExecResult | undefined): Record<string, unknown>[] {
  if (!result) return [];
  return result.values.map((row) => {
    const record: Record<string, unknown> = {};
    result.columns.forEach((column, index) => {
      record[column] = row[index];
    });
    return record;
  });
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function parsePkColumns(raw: unknown): string[] {
  if (typeof raw !== "string" || raw === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(asString) : [];
  } catch {
    return [];
  }
}

class ExplorerFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExplorerFormatError";
  }
}

/** Lee la metadata del artefacto y arma el catálogo navegable (tablas ordenadas por
 * nombre real; columnas por posición original). Lanza si el archivo no tiene la
 * forma del contrato (no es un artefacto de exploración de Platform Core). */
export function loadCatalog(exec: SqlExec): ExplorerCatalog {
  let metaRows: Record<string, unknown>[];
  try {
    metaRows = rowsAsObjects(exec("SELECT key, value FROM __mp_meta")[0]);
  } catch {
    throw new ExplorerFormatError(
      "El archivo no es un artefacto de exploración de Platform Core.",
    );
  }
  const metaMap = new Map(metaRows.map((row) => [asString(row.key), asString(row.value)]));
  const meta: ExplorerMeta = {
    formatVersion: metaMap.get("format_version") ?? null,
    policyVersion: metaMap.get("policy_version") ?? null,
    backupRunId: metaMap.get("backup_run_id") ?? null,
    createdAt: metaMap.get("created_at") ?? null,
  };

  const tables: ExplorerTable[] = rowsAsObjects(
    exec(
      "SELECT table_key, sqlite_table_name, schema_name, source_table_name, row_count, primary_key_columns_json FROM __mp_tables",
    )[0],
  ).map((row) => ({
    key: asString(row.table_key),
    sqliteName: asString(row.sqlite_table_name),
    schemaName: asString(row.schema_name),
    tableName: asString(row.source_table_name),
    rowCount: typeof row.row_count === "number" ? row.row_count : Number(row.row_count ?? 0),
    pkColumns: parsePkColumns(row.primary_key_columns_json),
  }));
  tables.sort((a, b) => a.tableName.localeCompare(b.tableName));

  const columnsByTable = new Map<string, ExplorerColumn[]>();
  const columnRows = rowsAsObjects(
    exec(
      "SELECT table_key, source_column_name, sqlite_column_name, source_type, ordinal_position, is_primary_key, is_foreign_key, is_visible FROM __mp_columns",
    )[0],
  );
  for (const row of columnRows) {
    const column: ExplorerColumn = {
      tableKey: asString(row.table_key),
      sourceName: asString(row.source_column_name),
      sqliteName: asString(row.sqlite_column_name),
      sourceType: asString(row.source_type),
      ordinal:
        typeof row.ordinal_position === "number"
          ? row.ordinal_position
          : Number(row.ordinal_position ?? 0),
      isPrimaryKey: row.is_primary_key === 1,
      isForeignKey: row.is_foreign_key === 1,
      visible: row.is_visible === 1,
    };
    const bucket = columnsByTable.get(column.tableKey);
    if (bucket) {
      bucket.push(column);
    } else {
      columnsByTable.set(column.tableKey, [column]);
    }
  }
  for (const bucket of columnsByTable.values()) {
    bucket.sort((a, b) => a.ordinal - b.ordinal);
  }
  return { meta, tables, columnsByTable };
}

/** Columnas VISIBLES de una tabla (las excluidas por la política quedan como huecos
 * explicables, no como datos). */
export function visibleColumns(catalog: ExplorerCatalog, tableKey: string): ExplorerColumn[] {
  return (catalog.columnsByTable.get(tableKey) ?? []).filter((column) => column.visible);
}

// Los identificadores del artefacto (t_<hash>, c_<posición>) los genera el propio
// backend, pero se valida su forma antes de interpolarlos en SQL: cualquier otra
// cosa se rechaza (el archivo podría venir de fuera).
const SAFE_TABLE_NAME = /^t_[0-9a-f]{8}$/;
const SAFE_COLUMN_NAME = /^c_\d{3}$/;

export function buildRowsQuery(
  table: ExplorerTable,
  columns: ExplorerColumn[],
  page: number,
  pageSize: number = EXPLORER_PAGE_SIZE,
): string {
  if (!SAFE_TABLE_NAME.test(table.sqliteName)) {
    throw new ExplorerFormatError("Nombre de tabla fuera del contrato del artefacto.");
  }
  const names = columns.map((column) => {
    if (!SAFE_COLUMN_NAME.test(column.sqliteName)) {
      throw new ExplorerFormatError("Nombre de columna fuera del contrato del artefacto.");
    }
    return column.sqliteName;
  });
  const selected = ["__mp_record_key", ...names].join(", ");
  const offset = Math.max(0, Math.floor(page)) * pageSize;
  return `SELECT ${selected} FROM ${table.sqliteName} ORDER BY __mp_record_key LIMIT ${pageSize} OFFSET ${offset}`;
}

export interface ExplorerRow {
  recordKey: string;
  cells: (string | null)[];
}

/** Filas del resultado paginado, en el mismo orden que las columnas pedidas. */
export function mapRows(result: ExecResult | undefined): ExplorerRow[] {
  if (!result) return [];
  return result.values.map((row) => ({
    recordKey: asString(row[0]),
    cells: row.slice(1).map((value) => (value === null ? null : asString(value))),
  }));
}

const CELL_MAX_LENGTH = 160;

/** Valor de celda para la rejilla: completo hasta el tope, truncado con elipsis
 * (el valor íntegro vive en el archivo; la UI lo muestra completo al abrir la fila). */
export function formatCell(value: string | null): string {
  if (value === null) return "—";
  if (value.length <= CELL_MAX_LENGTH) return value;
  return `${value.slice(0, CELL_MAX_LENGTH)}…`;
}

export function pageCount(rowCount: number, pageSize: number = EXPLORER_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(rowCount / pageSize));
}
