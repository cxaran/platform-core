// Acceso REAL a las APIs de Web Push del navegador (browser-only): registro
// del service worker, estado de la suscripción y alta/baja contra el backend.
// La lógica pura (detección, normalización) vive en push-support.ts.

import { browserApi } from "@/core/api/browser-client";

import {
  buildSubscriptionPayload,
  detectPushCapability,
  urlBase64ToUint8Array,
  type PushCapability,
} from "./push-support";

const SW_PATH = "/sw.js";

export function readPushCapability(): PushCapability {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "unsupported";
  }
  return detectPushCapability({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone:
      window.matchMedia?.("(display-mode: standalone)").matches === true ||
      // Propiedad propietaria de Safari iOS.
      (navigator as unknown as { standalone?: boolean }).standalone === true,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
    notificationPermission:
      "Notification" in window ? Notification.permission : null,
  });
}

/** Registra el SW (idempotente). Silencioso: la campana jamás rompe la página. */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(SW_PATH);
  } catch {
    return null;
  }
}

/** ¿Este navegador ya tiene una suscripción push viva? */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
    if (!registration) return null;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/** Pide permiso (requiere GESTO del usuario), suscribe y registra en el backend. */
export async function enablePush(): Promise<boolean> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;
    const registration = await ensureServiceWorker();
    if (!registration) return false;
    await navigator.serviceWorker.ready;
    const { public_key } = await browserApi<{ public_key: string }>(
      "/api/v1/notifications/push/public-key",
    );
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(public_key)
          .buffer as ArrayBuffer,
      }));
    const payload = buildSubscriptionPayload(subscription.toJSON());
    if (!payload) return false;
    await browserApi("/api/v1/notifications/push/subscription", {
      method: "PUT",
      body: { endpoint: payload.endpoint, keys: { ...payload.keys } },
    });
    return true;
  } catch {
    return false;
  }
}

/** Baja local + en el backend (best-effort). */
export async function disablePush(): Promise<void> {
  try {
    const subscription = await currentSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await browserApi("/api/v1/notifications/push/unsubscribe", {
      method: "POST",
      body: { endpoint },
    });
  } catch {
    // best-effort
  }
}
