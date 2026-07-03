import test from "node:test";
import assert from "node:assert/strict";

import {
  artifactKindLabel,
  downloadHref,
  formatBytes,
  formatCreatedTime,
  parseDriveFiles,
} from "./drive-files.ts";

// Módulo PURO de la vista de respaldos en Drive. La obtención (server-only) y el
// render se validan aparte; aquí la normalización de la respuesta y el formateo.

test("parseDriveFiles normaliza la respuesta y descarta entradas malformadas", () => {
  const parsed = parseDriveFiles({
    folder_id: "folder1",
    files: [
      {
        file_id: "f1",
        name: "platform-core-20260702T080000Z-abcd1234.tar",
        size_bytes: 2048,
        created_time: "2026-07-02T08:01:00.000Z",
        artifact_kind: "restore",
        backup_run_id: "run-1",
      },
      {
        file_id: "f2",
        name: "platform-core-20260702T080000Z-abcd1234.explorer.sqlite",
        artifact_kind: "explorer",
      },
      { name: "sin file_id: se descarta" },
      "basura",
    ],
  });
  assert.ok(parsed);
  assert.equal(parsed.folderId, "folder1");
  assert.equal(parsed.files.length, 2);
  assert.equal(parsed.files[0].artifactKind, "restore");
  assert.equal(parsed.files[0].sizeBytes, 2048);
  assert.equal(parsed.files[1].artifactKind, "explorer");
  assert.equal(parsed.files[1].sizeBytes, null);
  assert.equal(parsed.files[1].createdTime, null);
});

test("parseDriveFiles rechaza formas inesperadas", () => {
  assert.equal(parseDriveFiles(null), null);
  assert.equal(parseDriveFiles({ files: [] }), null);
  assert.equal(parseDriveFiles({ folder_id: "x", files: "no-lista" }), null);
});

test("un artifact_kind desconocido cae a restore (nunca rompe la vista)", () => {
  const parsed = parseDriveFiles({
    folder_id: "x",
    files: [{ file_id: "f", name: "n", artifact_kind: "rarito" }],
  });
  assert.ok(parsed);
  assert.equal(parsed.files[0].artifactKind, "restore");
});

test("downloadHref escapa el id y apunta al endpoint de streaming", () => {
  assert.equal(
    downloadHref("abc/../x"),
    "/api/v1/backups/drive-files/abc%2F..%2Fx/download",
  );
});

test("formatBytes usa unidades binarias legibles", () => {
  assert.equal(formatBytes(null), "—");
  assert.equal(formatBytes(-5), "—");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatBytes(150 * 1024 * 1024), "150 MB");
});

test("formatCreatedTime tolera nulos e inválidos", () => {
  assert.equal(formatCreatedTime(null), "—");
  assert.equal(formatCreatedTime("no-es-fecha"), "—");
  const formatted = formatCreatedTime("2026-07-02T08:01:00.000Z", "UTC");
  assert.ok(formatted.includes("2026"));
});

test("etiquetas de tipo en español", () => {
  assert.equal(artifactKindLabel("restore"), "Respaldo");
  assert.equal(artifactKindLabel("explorer"), "Exploración");
});
