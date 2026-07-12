import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSubscriptionPayload,
  detectPushCapability,
  isAppleMobile,
  urlBase64ToUint8Array,
  type PushEnvironment,
} from "./push-support.ts";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPAD_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function env(overrides: Partial<PushEnvironment>): PushEnvironment {
  return {
    userAgent: CHROME_UA,
    maxTouchPoints: 0,
    standalone: false,
    hasServiceWorker: true,
    hasPushManager: true,
    hasNotification: true,
    notificationPermission: "default",
    ...overrides,
  };
}

describe("isAppleMobile", () => {
  it("detecta iPhone por user agent", () => {
    assert.equal(isAppleMobile(IPHONE_UA, 5), true);
  });
  it("detecta iPad moderno (se anuncia como Mac táctil)", () => {
    assert.equal(isAppleMobile(IPAD_UA, 5), true);
  });
  it("una Mac real (sin touch) no es móvil Apple", () => {
    assert.equal(isAppleMobile(IPAD_UA, 0), false);
  });
  it("Chrome desktop no es móvil Apple", () => {
    assert.equal(isAppleMobile(CHROME_UA, 0), false);
  });
});

describe("detectPushCapability", () => {
  it("con todas las APIs disponibles: ready", () => {
    assert.equal(detectPushCapability(env({})), "ready");
  });
  it("permiso negado gana a todo", () => {
    assert.equal(
      detectPushCapability(env({ notificationPermission: "denied" })),
      "denied",
    );
  });
  it("iPhone en pestaña de Safari (sin PushManager): sugerir instalar", () => {
    assert.equal(
      detectPushCapability(
        env({
          userAgent: IPHONE_UA,
          maxTouchPoints: 5,
          hasPushManager: false,
          hasNotification: false,
        }),
      ),
      "needs-install",
    );
  });
  it("iPhone con la PWA YA instalada y APIs presentes: ready", () => {
    assert.equal(
      detectPushCapability(
        env({ userAgent: IPHONE_UA, maxTouchPoints: 5, standalone: true }),
      ),
      "ready",
    );
  });
  it("iPad instalado pero SIN APIs (iOS viejo): unsupported", () => {
    assert.equal(
      detectPushCapability(
        env({
          userAgent: IPAD_UA,
          maxTouchPoints: 5,
          standalone: true,
          hasPushManager: false,
          hasNotification: false,
        }),
      ),
      "unsupported",
    );
  });
  it("desktop sin APIs de push: unsupported (no pedir instalar)", () => {
    assert.equal(
      detectPushCapability(env({ hasPushManager: false })),
      "unsupported",
    );
  });
});

describe("urlBase64ToUint8Array", () => {
  it("decodifica base64url con caracteres -/_ y sin padding", () => {
    // "BA-_" en base64url = bytes [4, 15, 191]
    const bytes = urlBase64ToUint8Array("BA-_");
    assert.deepEqual(Array.from(bytes), [4, 15, 191]);
  });
  it("una applicationServerKey P-256 típica mide 65 bytes", () => {
    const key = Buffer.from(
      new Uint8Array(65).map((_, i) => (i === 0 ? 4 : i)),
    ).toString("base64url");
    assert.equal(urlBase64ToUint8Array(key).length, 65);
  });
});

describe("buildSubscriptionPayload", () => {
  it("normaliza el toJSON() completo", () => {
    const payload = buildSubscriptionPayload({
      endpoint: "https://push.example/e1",
      expirationTime: null,
      keys: { p256dh: "pk", auth: "ak" },
    });
    assert.deepEqual(payload, {
      endpoint: "https://push.example/e1",
      keys: { p256dh: "pk", auth: "ak" },
    });
  });
  it("rechaza estructuras incompletas", () => {
    assert.equal(buildSubscriptionPayload(null), null);
    assert.equal(buildSubscriptionPayload({}), null);
    assert.equal(
      buildSubscriptionPayload({ endpoint: "https://x", keys: { p256dh: "pk" } }),
      null,
    );
    assert.equal(
      buildSubscriptionPayload({ endpoint: "", keys: { p256dh: "a", auth: "b" } }),
      null,
    );
  });
});
