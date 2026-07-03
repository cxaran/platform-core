import assert from "node:assert/strict";
import test from "node:test";

import type { ResourceListCapability } from "@/core/api/contracts";

import {
  buildExportCell,
  buildExportRows,
  enumLabelMaps,
  exportColumns,
  headerLabels,
  numericColumnIndexes,
} from "./build-export-rows";

// Capability mínima para las pruebas (solo los campos que usa el módulo).
function listCapability(): ResourceListCapability {
  return {
    fields: [
      { name: "record", label: "Expediente", type: "integer", sortable: true, visible_in_list: true },
      { name: "full_name", label: "Nombre", type: "string", sortable: true, visible_in_list: true },
      { name: "status", label: "Estado", type: "enum", sortable: false, visible_in_list: true },
      { name: "internal", label: "Interno", type: "string", sortable: false, visible_in_list: false },
    ],
    filterable_fields: [
      {
        key: "status",
        label: "Estado",
        value_type: "enum",
        operators: [
          {
            key: "eq",
            label: "Es igual a",
            widget: "select",
            value_shape: "single",
            parameter_name: "status",
            options: [
              { value: "active", label: "Activo" },
              { value: "archived", label: "Archivado" },
            ],
          },
        ],
      },
    ],
  } as unknown as ResourceListCapability;
}

test("exportColumns: visibles en lista menos ocultas por el usuario", () => {
  const columns = exportColumns(listCapability(), new Set(["full_name"]));
  assert.deepEqual(
    columns.map((column) => column.name),
    ["record", "status"],
  );
  assert.deepEqual(headerLabels(columns), ["Expediente", "Estado"]);
});

test("enum usa el label del contrato y cae al valor crudo sin opciones", () => {
  const labels = enumLabelMaps(listCapability());
  assert.equal(buildExportCell("active", "enum", labels.get("status")).text, "Activo");
  assert.equal(buildExportCell("unknown", "enum", labels.get("status")).text, "unknown");
});

test("números: nativos para Excel, texto si no parsean", () => {
  assert.deepEqual(buildExportCell(42, "integer"), { kind: "number", value: 42, text: "42" });
  assert.deepEqual(buildExportCell("3.5", "decimal"), { kind: "number", value: 3.5, text: "3.5" });
  assert.equal(buildExportCell("n/a", "decimal").kind, "text");
});

test("boolean nativo con texto Sí/No", () => {
  assert.deepEqual(buildExportCell(true, "boolean"), { kind: "boolean", value: true, text: "Sí" });
  assert.equal(buildExportCell("yes", "boolean").kind, "empty");
});

test("date: fecha civil por partes, sin desplazamiento de día", () => {
  const cell = buildExportCell("2026-06-30", "date");
  assert.equal(cell.kind, "date");
  if (cell.kind === "date") {
    assert.equal(cell.text, "30/06/2026");
    assert.equal(cell.value.getFullYear(), 2026);
    assert.equal(cell.value.getMonth(), 5);
    assert.equal(cell.value.getDate(), 30);
  }
});

test("datetime naive se parsea como UTC (mismo instante en cualquier zona)", () => {
  const cell = buildExportCell("2026-06-30T17:23:00", "datetime");
  assert.equal(cell.kind, "datetime");
  if (cell.kind === "datetime") {
    assert.equal(cell.value.getTime(), Date.UTC(2026, 5, 30, 17, 23, 0));
  }
});

test("null/undefined → celda vacía; arrays escalares se unen", () => {
  assert.equal(buildExportCell(null, "string").kind, "empty");
  assert.equal(buildExportCell(["a", 2, true], "array").text, "a, 2, Sí");
});

test("buildExportRows matriz completa", () => {
  const list = listCapability();
  const columns = exportColumns(list, new Set());
  const matrix = buildExportRows(columns, enumLabelMaps(list), [
    { record: 7, full_name: "Ana", status: "archived" },
  ]);
  assert.deepEqual(
    matrix[0].map((cell) => cell.text),
    ["7", "Ana", "Archivado"],
  );
  assert.deepEqual([...numericColumnIndexes(columns)], [0]);
});
