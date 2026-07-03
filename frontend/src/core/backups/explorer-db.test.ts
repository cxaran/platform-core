import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRowsQuery,
  formatCell,
  isEncryptedName,
  loadCatalog,
  mapRows,
  pageCount,
  visibleColumns,
  type ExecResult,
  type SqlExec,
} from "./explorer-db.ts";

// Fake mínimo del exec de sql.js: responde por prefijo de consulta.
function fakeExec(responses: Record<string, ExecResult>): SqlExec {
  return (sql: string) => {
    for (const [prefix, result] of Object.entries(responses)) {
      if (sql.startsWith(prefix)) return [result];
    }
    throw new Error(`no such table: ${sql}`);
  };
}

const CATALOG_RESPONSES: Record<string, ExecResult> = {
  "SELECT key, value FROM __mp_meta": {
    columns: ["key", "value"],
    values: [
      ["format_version", "1"],
      ["policy_version", "1"],
      ["backup_run_id", "run-1"],
      ["created_at", "2026-07-02T08:00:00+00:00"],
    ],
  },
  "SELECT table_key, sqlite_table_name": {
    columns: [
      "table_key",
      "sqlite_table_name",
      "schema_name",
      "source_table_name",
      "row_count",
      "primary_key_columns_json",
    ],
    values: [
      ["public.patients", "t_f3a9c2e1", "public", "patients", 12, '["id"]'],
      ["public.audit", "t_aaaa1111", "public", "audit", 0, "[]"],
    ],
  },
  "SELECT table_key, source_column_name": {
    columns: [
      "table_key",
      "source_column_name",
      "sqlite_column_name",
      "source_type",
      "ordinal_position",
      "is_primary_key",
      "is_foreign_key",
      "is_visible",
    ],
    values: [
      ["public.patients", "full_name", "c_002", "text", 2, 0, 0, 1],
      ["public.patients", "id", "c_001", "uuid", 1, 1, 0, 1],
      ["public.patients", "password_hash", "c_003", "text", 3, 0, 0, 0],
    ],
  },
};

test("loadCatalog arma metadata, tablas ordenadas y columnas por posición", () => {
  const catalog = loadCatalog(fakeExec(CATALOG_RESPONSES));
  assert.equal(catalog.meta.backupRunId, "run-1");
  assert.equal(catalog.meta.policyVersion, "1");
  assert.deepEqual(
    catalog.tables.map((t) => t.tableName),
    ["audit", "patients"],
  );
  assert.deepEqual(catalog.tables[1].pkColumns, ["id"]);
  const columns = catalog.columnsByTable.get("public.patients");
  assert.ok(columns);
  assert.deepEqual(
    columns.map((c) => c.sourceName),
    ["id", "full_name", "password_hash"],
  );
});

test("loadCatalog rechaza archivos que no son artefactos de exploración", () => {
  const empty: SqlExec = () => {
    throw new Error("no such table: __mp_meta");
  };
  assert.throws(() => loadCatalog(empty), /no es un artefacto de exploración/);
});

test("visibleColumns filtra las excluidas por la política (quedan como huecos)", () => {
  const catalog = loadCatalog(fakeExec(CATALOG_RESPONSES));
  const visible = visibleColumns(catalog, "public.patients");
  assert.deepEqual(
    visible.map((c) => c.sourceName),
    ["id", "full_name"],
  );
});

test("buildRowsQuery pagina con orden estable y valida identificadores", () => {
  const catalog = loadCatalog(fakeExec(CATALOG_RESPONSES));
  const table = catalog.tables.find((t) => t.tableName === "patients");
  assert.ok(table);
  const columns = visibleColumns(catalog, table.key);
  const sql = buildRowsQuery(table, columns, 2, 50);
  assert.equal(
    sql,
    "SELECT __mp_record_key, c_001, c_002 FROM t_f3a9c2e1 ORDER BY __mp_record_key LIMIT 50 OFFSET 100",
  );
  // Identificadores fuera del contrato: se rechazan (el archivo podría venir de fuera).
  assert.throws(
    () => buildRowsQuery({ ...table, sqliteName: "patients; DROP" }, columns, 0),
    /fuera del contrato/,
  );
  assert.throws(
    () =>
      buildRowsQuery(table, [{ ...columns[0], sqliteName: "c_1; --" }], 0),
    /fuera del contrato/,
  );
});

test("mapRows y formatCell proyectan la rejilla", () => {
  const rows = mapRows({
    columns: ["__mp_record_key", "c_001", "c_002"],
    values: [
      ["k1", "uuid-1", "María López"],
      ["k2", "uuid-2", null],
    ],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].recordKey, "k1");
  assert.deepEqual(rows[1].cells, ["uuid-2", null]);
  assert.equal(formatCell(null), "—");
  assert.equal(formatCell("corto"), "corto");
  assert.ok(formatCell("x".repeat(500)).endsWith("…"));
  assert.equal(formatCell("x".repeat(500)).length, 161);
});

test("utilitarios de paginación y cifrado", () => {
  assert.equal(pageCount(0), 1);
  assert.equal(pageCount(50), 1);
  assert.equal(pageCount(51), 2);
  assert.equal(isEncryptedName("a.explorer.sqlite.age"), true);
  assert.equal(isEncryptedName("a.explorer.sqlite"), false);
});
