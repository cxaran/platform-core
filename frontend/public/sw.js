/* Service worker de la PWA: recibe Web Push y muestra la notificación del
 * sistema. El payload lo arma el backend (push_service): título, cuerpo, kind
 * y la URL a abrir al tocarla. También avisa a las pestañas abiertas para que
 * la campana se refresque al instante sin esperar el sondeo. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Notificación", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "Notificación";
  const options = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: payload.notification_id || undefined, // reemplaza duplicados del mismo aviso
    data: { url: payload.url || "/" },
  };
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      // Refresco inmediato de la campana en las pestañas abiertas.
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clientList) {
        client.postMessage({ type: "notification" });
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Si ya hay una pestaña de la app, se reutiliza (navega y enfoca).
      for (const client of clientList) {
        if ("focus" in client) {
          if ("navigate" in client) {
            try {
              await client.navigate(url);
            } catch {
              // Navegación bloqueada (p. ej. origen distinto): solo enfocar.
            }
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
