"use client";

// Visor del artefacto de EXPLORACIÓN: TODO ocurre en el navegador. Los bytes llegan
// del endpoint de descarga existente (misma cookie de sesión); si el archivo está
// cifrado (.age) la clave privada se pide AQUÍ y el descifrado es local — la clave
// jamás se envía al backend ni a ningún servicio. El SQLite se abre con sql.js
// (WebAssembly, /sql-wasm.wasm) y la navegación usa sólo la metadata __mp_* del
// propio archivo (módulo puro core/backups/explorer-db.ts).

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { downloadHref } from "@/core/backups/drive-files";
import {
  buildRowsQuery,
  formatCell,
  isEncryptedName,
  loadCatalog,
  mapRows,
  pageCount,
  visibleColumns,
  EXPLORER_PAGE_SIZE,
  type ExplorerCatalog,
  type ExplorerRow,
  type SqlExec,
} from "@/core/backups/explorer-db";

type Stage =
  | { kind: "downloading" }
  | { kind: "locked"; error: string | null }
  | { kind: "opening" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

interface SqlJsDatabase {
  exec(sql: string): { columns: string[]; values: unknown[][] }[];
  close(): void;
}

async function openDatabase(bytes: Uint8Array): Promise<SqlJsDatabase> {
  const initSqlJs = (await import("sql.js")).default;
  const SQL = await initSqlJs({ locateFile: () => "/sql-wasm.wasm" });
  return new SQL.Database(bytes) as unknown as SqlJsDatabase;
}

async function decryptWithAge(bytes: Uint8Array, identity: string): Promise<Uint8Array> {
  const { Decrypter } = await import("age-encryption");
  const decrypter = new Decrypter();
  decrypter.addIdentity(identity.trim());
  return decrypter.decrypt(bytes, "uint8array");
}

export function ExplorerView({
  fileId,
  fileName,
}: Readonly<{ fileId: string; fileName: string }>) {
  const [stage, setStage] = useState<Stage>({ kind: "downloading" });
  const [catalog, setCatalog] = useState<ExplorerCatalog | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [identityInput, setIdentityInput] = useState("");
  // La base abierta es ESTADO (las filas se derivan de ella en render); el
  // ciphertext pendiente sí es ref: sólo lo tocan callbacks.
  const [database, setDatabase] = useState<SqlJsDatabase | null>(null);
  const cipherRef = useRef<Uint8Array | null>(null);

  const openFromBytes = useCallback(async (bytes: Uint8Array) => {
    setStage({ kind: "opening" });
    try {
      const db = await openDatabase(bytes);
      const exec: SqlExec = (sql) => db.exec(sql);
      const loaded = loadCatalog(exec);
      setDatabase(db);
      setCatalog(loaded);
      setSelectedKey(loaded.tables[0]?.key ?? null);
      setPage(0);
      setStage({ kind: "ready" });
    } catch (error) {
      setStage({
        kind: "error",
        message:
          error instanceof Error ? error.message : "No se pudo abrir el archivo SQLite.",
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(downloadHref(fileId));
        if (!response.ok) {
          setStage({
            kind: "error",
            message:
              response.status === 404
                ? "El archivo ya no existe en la carpeta de respaldos."
                : `No se pudo descargar el archivo (HTTP ${response.status}).`,
          });
          return;
        }
        const buffer = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return;
        if (isEncryptedName(fileName)) {
          cipherRef.current = buffer;
          setStage({ kind: "locked", error: null });
        } else {
          await openFromBytes(buffer);
        }
      } catch {
        if (!cancelled) {
          setStage({ kind: "error", message: "No se pudo descargar el archivo." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileId, fileName, openFromBytes]);

  // Cierra la base al reemplazarla o desmontar (libera la memoria del WASM).
  useEffect(() => {
    return () => {
      database?.close();
    };
  }, [database]);

  const unlock = useCallback(async () => {
    const cipher = cipherRef.current;
    if (!cipher || !identityInput.trim()) return;
    try {
      const plain = await decryptWithAge(cipher, identityInput);
      setIdentityInput("");
      cipherRef.current = null;
      await openFromBytes(plain);
    } catch {
      setStage({
        kind: "locked",
        error: "No se pudo descifrar: verifica que la clave privada sea la correcta.",
      });
    }
  }, [identityInput, openFromBytes]);

  const table = useMemo(
    () => catalog?.tables.find((t) => t.key === selectedKey) ?? null,
    [catalog, selectedKey],
  );
  const columns = useMemo(
    () => (catalog && table ? visibleColumns(catalog, table.key) : []),
    [catalog, table],
  );
  const rows: ExplorerRow[] = useMemo(() => {
    if (!database || !table || columns.length === 0) return [];
    try {
      return mapRows(database.exec(buildRowsQuery(table, columns, page))[0]);
    } catch {
      return [];
    }
  }, [database, table, columns, page]);

  const totalPages = table ? pageCount(table.rowCount) : 1;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--tx)]">
            Explorar respaldo
          </h1>
          <p className="font-mono text-xs text-[var(--tx3)]">{fileName}</p>
          <p className="text-sm text-[var(--tx2)]">
            Sólo lectura. El archivo se abre en tu navegador; nada se envía a ningún
            servidor.
          </p>
        </div>
        <Link
          href="/backups"
          className="rounded-[8px] border border-[var(--border2)] bg-[var(--panel2)] px-3 py-2 text-xs font-semibold text-[var(--tx)] transition hover:opacity-90"
        >
          Volver a respaldos
        </Link>
      </div>

      {stage.kind === "downloading" && (
        <p className="text-sm text-[var(--tx2)]">Descargando el archivo de Google Drive…</p>
      )}
      {stage.kind === "opening" && (
        <p className="text-sm text-[var(--tx2)]">Abriendo la base de datos…</p>
      )}
      {stage.kind === "error" && (
        <section className="rounded-[14px] border border-[var(--border2)] bg-[var(--panel)] p-5">
          <p className="text-sm text-[var(--tx)]">{stage.message}</p>
        </section>
      )}

      {stage.kind === "locked" && (
        <section className="flex max-w-xl flex-col gap-3 rounded-[14px] border border-[var(--border2)] bg-[var(--panel)] p-5">
          <h2 className="text-sm font-semibold text-[var(--tx)]">Archivo cifrado</h2>
          <p className="text-sm text-[var(--tx2)]">
            Este archivo está cifrado con age. Pega la clave privada
            (AGE-SECRET-KEY-…) que recibiste por correo: el descifrado ocurre en tu
            navegador y la clave no se envía ni se guarda en ningún lado.
          </p>
          <textarea
            value={identityInput}
            onChange={(event) => setIdentityInput(event.target.value)}
            rows={2}
            autoComplete="off"
            spellCheck={false}
            placeholder="AGE-SECRET-KEY-1…"
            className="rounded-[8px] border border-[var(--border2)] bg-[var(--panel2)] px-3 py-2 font-mono text-xs text-[var(--tx)]"
          />
          {stage.error && <p className="text-xs text-[var(--danger,#e5484d)]">{stage.error}</p>}
          <div>
            <button
              type="button"
              onClick={unlock}
              disabled={!identityInput.trim()}
              className="rounded-[8px] bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-[var(--on-accent)] transition hover:opacity-90 disabled:opacity-50"
            >
              Descifrar y abrir
            </button>
          </div>
        </section>
      )}

      {stage.kind === "ready" && catalog && (
        <div className="flex flex-col gap-4 lg:flex-row">
          <nav className="flex max-h-[70vh] w-full flex-col gap-1 overflow-y-auto rounded-[14px] border border-[var(--border2)] bg-[var(--panel)] p-3 lg:w-64">
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--tx3)]">
              Tablas ({catalog.tables.length})
            </p>
            {catalog.tables.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => {
                  setSelectedKey(entry.key);
                  setPage(0);
                }}
                className={`flex items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 text-left text-xs transition ${
                  entry.key === selectedKey
                    ? "bg-[var(--accent)] font-semibold text-[var(--on-accent)]"
                    : "text-[var(--tx)] hover:bg-[var(--panel2)]"
                }`}
              >
                <span className="truncate font-mono">{entry.tableName}</span>
                <span className="shrink-0 text-[10px] opacity-70">{entry.rowCount}</span>
              </button>
            ))}
          </nav>

          <section className="flex min-w-0 flex-1 flex-col gap-3">
            {table && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-mono text-sm font-semibold text-[var(--tx)]">
                    {table.schemaName}.{table.tableName}
                  </h2>
                  <div className="flex items-center gap-2 text-xs text-[var(--tx2)]">
                    <button
                      type="button"
                      onClick={() => setPage((current) => Math.max(0, current - 1))}
                      disabled={page === 0}
                      className="rounded-[8px] border border-[var(--border2)] bg-[var(--panel2)] px-2 py-1 disabled:opacity-40"
                    >
                      ←
                    </button>
                    <span>
                      Página {page + 1} de {totalPages} · {table.rowCount} filas
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setPage((current) => Math.min(totalPages - 1, current + 1))
                      }
                      disabled={page >= totalPages - 1}
                      className="rounded-[8px] border border-[var(--border2)] bg-[var(--panel2)] px-2 py-1 disabled:opacity-40"
                    >
                      →
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto rounded-[14px] border border-[var(--border2)] bg-[var(--panel)]">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border2)] text-left text-[11px] text-[var(--tx3)]">
                        {columns.map((column) => (
                          <th
                            key={column.sqliteName}
                            className="whitespace-nowrap px-3 py-2 font-mono font-medium"
                            title={column.sourceType}
                          >
                            {column.sourceName}
                            {column.isPrimaryKey ? " 🔑" : ""}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 && (
                        <tr>
                          <td
                            colSpan={Math.max(1, columns.length)}
                            className="px-3 py-6 text-center text-[var(--tx3)]"
                          >
                            Sin filas.
                          </td>
                        </tr>
                      )}
                      {rows.map((row) => (
                        <tr
                          key={row.recordKey}
                          className="border-b border-[var(--border2)] align-top last:border-b-0"
                        >
                          {row.cells.map((cell, index) => (
                            <td
                              key={columns[index]?.sqliteName ?? index}
                              className="max-w-[360px] whitespace-pre-wrap break-words px-3 py-2 text-[var(--tx)]"
                              title={cell ?? undefined}
                            >
                              {formatCell(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {EXPLORER_PAGE_SIZE < table.rowCount && (
                  <p className="text-[11px] text-[var(--tx3)]">
                    Mostrando {EXPLORER_PAGE_SIZE} filas por página en orden estable.
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
