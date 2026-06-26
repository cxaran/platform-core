import test from "node:test";
import assert from "node:assert/strict";

import type { ResourceListCapability } from "@/core/api/contracts";
import {
  FilterableContractError,
  appendFilterableParams,
  buildFilterableControls,
  parseFilterableValues,
} from "./filterable.ts";

type FilterableField = NonNullable<ResourceListCapability["filterable_fields"]>[number];

function makeList(fields: FilterableField[]): ResourceListCapability {
  return { filterable_fields: fields } as unknown as ResourceListCapability;
}

function adminLikeList(): ResourceListCapability {
  return makeList([
    {
      key: "name",
      label: "Nombre",
      value_type: "string",
      operators: [
        { key: "contains", label: "Contiene", value_shape: "single", widget: "text", parameter_name: "name_contains", case_sensitive: false },
        { key: "eq", label: "Es igual a", value_shape: "single", widget: "text", parameter_name: "name", case_sensitive: true },
      ],
    },
    {
      key: "is_active",
      label: "Activo",
      value_type: "boolean",
      operators: [
        {
          key: "eq",
          label: "Es igual a",
          value_shape: "single",
          widget: "select",
          parameter_name: "is_active",
          options: [
            { value: "true", label: "Activos" },
            { value: "false", label: "Inactivos" },
          ],
        },
      ],
    },
    {
      key: "created_at",
      label: "Creado",
      value_type: "datetime",
      operators: [
        { key: "on", label: "En la fecha", value_shape: "single", widget: "date", parameter_name: "created_at_on", calendar_timezone: "UTC" },
        {
          key: "between",
          label: "Entre",
          value_shape: "range",
          widget: "daterange",
          parameters: { from: "created_at_from", to: "created_at_to" },
          calendar_timezone: "UTC",
          range_end_inclusive: true,
        },
      ],
    },
  ] as FilterableField[]);
}

test("buildFilterableControls expone todos los parámetros reales en orden", () => {
  const controls = buildFilterableControls(adminLikeList());
  assert.deepEqual(controls.paramNames, [
    "name_contains",
    "name",
    "is_active",
    "created_at_on",
    "created_at_from",
    "created_at_to",
  ]);
  assert.equal(controls.ordered.length, 3);
});

test("parseFilterableValues acepta solo valores válidos del contrato", () => {
  const controls = buildFilterableControls(adminLikeList());
  const filters = parseFilterableValues(
    {
      name_contains: "  ana  ",
      is_active: "true",
      created_at_on: "2026-06-15",
      created_at_from: "2026-13-40", // fecha inválida -> se ignora
      unknown_param: "x", // no declarado -> se ignora
    },
    controls,
  );
  assert.deepEqual(filters, {
    name_contains: "ana",
    is_active: "true",
    created_at_on: "2026-06-15",
  });
});

test("parseFilterableValues rechaza un value de select fuera de las opciones", () => {
  const controls = buildFilterableControls(adminLikeList());
  const filters = parseFilterableValues({ is_active: "maybe" }, controls);
  assert.deepEqual(filters, {});
});

test("parseFilterableValues descarta texto vacío y demasiado largo", () => {
  const controls = buildFilterableControls(adminLikeList());
  const tooLong = "a".repeat(201);
  const filters = parseFilterableValues({ name_contains: "   ", name: tooLong }, controls);
  assert.deepEqual(filters, {});
});

test("appendFilterableParams emite solo la allowlist revalidada", () => {
  const controls = buildFilterableControls(adminLikeList());
  const params = new URLSearchParams();
  appendFilterableParams(
    params,
    { name_contains: "ana", created_at_from: "2026-01-01", created_at_to: "bad", forged: "x" },
    controls,
  );
  assert.equal(params.get("name_contains"), "ana");
  assert.equal(params.get("created_at_from"), "2026-01-01");
  assert.equal(params.get("created_at_to"), null); // value inválido no se emite
  assert.equal(params.get("forged"), null); // no declarado
});

test("buildFilterableControls falla ante un parámetro duplicado", () => {
  const list = makeList([
    {
      key: "a",
      label: "A",
      value_type: "string",
      operators: [
        { key: "contains", label: "Contiene", value_shape: "single", widget: "text", parameter_name: "dup" },
      ],
    },
    {
      key: "b",
      label: "B",
      value_type: "string",
      operators: [
        { key: "eq", label: "Es igual a", value_shape: "single", widget: "text", parameter_name: "dup" },
      ],
    },
  ] as FilterableField[]);
  assert.throws(() => buildFilterableControls(list), FilterableContractError);
});

test("buildFilterableControls falla si un select no declara opciones", () => {
  const list = makeList([
    {
      key: "is_active",
      label: "Activo",
      value_type: "boolean",
      operators: [
        { key: "eq", label: "Es igual a", value_shape: "single", widget: "select", parameter_name: "is_active" },
      ],
    },
  ] as FilterableField[]);
  assert.throws(() => buildFilterableControls(list), FilterableContractError);
});

test("buildFilterableControls falla si daterange no declara parameters", () => {
  const list = makeList([
    {
      key: "created_at",
      label: "Creado",
      value_type: "datetime",
      operators: [
        { key: "between", label: "Entre", value_shape: "range", widget: "daterange" },
      ],
    },
  ] as FilterableField[]);
  assert.throws(() => buildFilterableControls(list), FilterableContractError);
});
