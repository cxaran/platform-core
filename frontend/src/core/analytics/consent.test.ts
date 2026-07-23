import assert from "node:assert/strict";
import { test } from "node:test";

import {
  gtagScriptUrl,
  readStoredConsent,
  shouldLoadAnalytics,
  shouldShowConsentBanner,
} from "./consent";

const ENABLED = {
  enabled: true,
  measurement_id: "G-ABC123XYZ0",
  require_consent: true,
  debug_mode: false,
};

test("apagada o sin ID: no carga ni pregunta", () => {
  assert.equal(shouldLoadAnalytics(null, "granted"), false);
  assert.equal(shouldLoadAnalytics({ enabled: false }, "granted"), false);
  assert.equal(shouldLoadAnalytics({ enabled: true, measurement_id: null }, "granted"), false);
  assert.equal(shouldShowConsentBanner({ enabled: false }, "undecided"), false);
});

test("con consentimiento requerido: solo carga tras aceptar", () => {
  assert.equal(shouldLoadAnalytics(ENABLED, "undecided"), false);
  assert.equal(shouldLoadAnalytics(ENABLED, "denied"), false);
  assert.equal(shouldLoadAnalytics(ENABLED, "granted"), true);
});

test("el aviso solo aparece mientras no haya decisión", () => {
  assert.equal(shouldShowConsentBanner(ENABLED, "undecided"), true);
  assert.equal(shouldShowConsentBanner(ENABLED, "granted"), false);
  assert.equal(shouldShowConsentBanner(ENABLED, "denied"), false);
});

test("sin require_consent: carga directo y sin aviso", () => {
  const open = { ...ENABLED, require_consent: false };
  assert.equal(shouldLoadAnalytics(open, "undecided"), true);
  assert.equal(shouldShowConsentBanner(open, "undecided"), false);
});

test("el consentimiento almacenado solo acepta valores conocidos", () => {
  assert.equal(readStoredConsent("granted"), "granted");
  assert.equal(readStoredConsent("denied"), "denied");
  assert.equal(readStoredConsent("basura"), "undecided");
  assert.equal(readStoredConsent(null), "undecided");
});

test("la URL de gtag escapa el ID", () => {
  assert.equal(
    gtagScriptUrl("G-ABC123XYZ0"),
    "https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ0",
  );
  assert.ok(gtagScriptUrl("G-A&B=C").includes("G-A%26B%3DC"));
});
