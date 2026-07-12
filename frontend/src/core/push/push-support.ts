// Módulo PURO de Web Push: detección de capacidades por PLATAFORMA y
// normalización de la suscripción del navegador. Sin DOM ni fetch (testeable
// con node:test); el acceso real a las APIs vive en push-client.ts.
//
// La regla de iOS es por CAPACIDAD, no por versión: Safari solo expone
// PushManager DENTRO de la app instalada en la pantalla de inicio. En una
// pestaña normal de iOS no hay push posible — se sugiere instalar la PWA.

export type PushCapability =
  | "ready" // hay APIs de push: se puede pedir permiso y suscribir
  | "needs-install" // iOS/iPadOS en pestaña: instalar la PWA primero
  | "denied" // el usuario ya negó el permiso de notificaciones
  | "unsupported"; // navegador sin Web Push (o iOS viejo)

export interface PushEnvironment {
  userAgent: string;
  maxTouchPoints: number;
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  notificationPermission: string | null;
}

/** iPhone/iPod dicen su nombre; iPad moderno se reporta como macOS táctil. */
export function isAppleMobile(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

export function detectPushCapability(env: PushEnvironment): PushCapability {
  if (env.notificationPermission === "denied") return "denied";
  const hasApis = env.hasServiceWorker && env.hasPushManager && env.hasNotification;
  if (hasApis) return "ready";
  if (isAppleMobile(env.userAgent, env.maxTouchPoints) && !env.standalone) {
    // Sin APIs + iOS + pestaña normal: la PWA instalada SÍ las tendría
    // (iOS 16.4+). En iOS viejo instalar tampoco ayuda, pero no hay forma
    // fiable de distinguirlo sin parsear versiones: la instrucción de
    // instalar es la única ruta posible en ambos casos.
    return "needs-install";
  }
  return "unsupported";
}

/** applicationServerKey: base64url → bytes (formato de PushManager.subscribe). */
export function urlBase64ToUint8Array(base64url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export interface SubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Normaliza `PushSubscription.toJSON()` al contrato del backend (o null). */
export function buildSubscriptionPayload(json: unknown): SubscriptionPayload | null {
  if (typeof json !== "object" || json === null) return null;
  const data = json as Record<string, unknown>;
  const endpoint = data.endpoint;
  const keys = data.keys;
  if (typeof endpoint !== "string" || endpoint === "") return null;
  if (typeof keys !== "object" || keys === null) return null;
  const { p256dh, auth } = keys as Record<string, unknown>;
  if (typeof p256dh !== "string" || p256dh === "") return null;
  if (typeof auth !== "string" || auth === "") return null;
  return { endpoint, keys: { p256dh, auth } };
}
