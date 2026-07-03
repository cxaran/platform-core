import test from "node:test";
import assert from "node:assert/strict";

import {
  itemRoute,
  parseSetupChecklist,
  shouldShowBanner,
} from "./setup-checklist.ts";

// Módulo PURO del checklist de puesta en marcha (el estado lo deriva el backend).

test("parseSetupChecklist normaliza y descarta entradas malformadas", () => {
  const parsed = parseSetupChecklist({
    items: [
      { key: "email", title: "Correo saliente", status: "pending", detail: "Configura…" },
      { key: "backups", title: "Respaldos", status: "complete", detail: "OK" },
      { key: "x", title: "Raro", status: "explotado", detail: "" },
      "basura",
    ],
    dismissed: false,
    pending_count: 3,
    environment: "local",
  });
  assert.ok(parsed);
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.pendingCount, 3);
  assert.equal(parsed.environment, "local");
  assert.equal(parseSetupChecklist(null), null);
  assert.equal(parseSetupChecklist({ dismissed: true }), null);
});

test("shouldShowBanner: sólo con pendientes y sin descarte", () => {
  const base = {
    items: [],
    dismissed: false,
    pendingCount: 2,
    environment: "local",
  };
  assert.equal(shouldShowBanner(base), true);
  assert.equal(shouldShowBanner({ ...base, dismissed: true }), false);
  assert.equal(shouldShowBanner({ ...base, pendingCount: 0 }), false);
  assert.equal(shouldShowBanner(null), false);
});

test("itemRoute enruta cada ítem a su sección (con fallback)", () => {
  assert.equal(itemRoute("backups"), "/backups");
  assert.equal(itemRoute("desconocido"), "/resources/system_settings");
});
