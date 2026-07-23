import test from "node:test";
import assert from "node:assert/strict";

import { RELATIVE_DATE_PRESETS } from "./relative-dates.ts";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const TZ = "America/Monterrey";

test("cada preset produce un rango civil ISO con from <= to", () => {
  for (const preset of RELATIVE_DATE_PRESETS) {
    const { from, to } = preset.range(TZ);
    assert.match(from, ISO, `${preset.key} from`);
    assert.match(to, ISO, `${preset.key} to`);
    assert.ok(from <= to, `${preset.key}: ${from} <= ${to}`);
  }
});

test("'hoy' colapsa a un solo día", () => {
  const today = RELATIVE_DATE_PRESETS.find((preset) => preset.key === "today");
  const { from, to } = today!.range(TZ);
  assert.equal(from, to);
});

test("'este mes' empieza el día 1 y termina en o después del 1", () => {
  const month = RELATIVE_DATE_PRESETS.find((preset) => preset.key === "this_month");
  const { from, to } = month!.range(TZ);
  assert.ok(from.endsWith("-01"), `from empieza el día 1: ${from}`);
  assert.ok(from <= to);
});

test("'este año' empieza el 1 de enero", () => {
  const year = RELATIVE_DATE_PRESETS.find((preset) => preset.key === "this_year");
  const { from } = year!.range(TZ);
  assert.ok(from.endsWith("-01-01"), `from es 1 de enero: ${from}`);
});
