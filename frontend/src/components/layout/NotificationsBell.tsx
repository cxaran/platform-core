"use client";

// Campana de notificaciones: badge con no-leídas + panel desplegable con la
// lista y «descartar». Sondea /notifications/me cada 60 s y al abrir el panel
// COMO RESPALDO; el medio principal en tiempo real es Web Push (service
// worker): la notificación llega aunque la pestaña esté cerrada, y el SW avisa
// a las pestañas abiertas para refrescar la campana al instante. En iOS el push
// exige la PWA instalada — el panel lo explica cuando aplica (needs-install).

import Link from "next/link";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";

import { browserApi } from "@/core/api/browser-client";
import {
  currentSubscription,
  disablePush,
  enablePush,
  ensureServiceWorker,
  readPushCapability,
} from "@/core/push/push-client";
import type { PushCapability } from "@/core/push/push-support";
import type { components } from "@/generated/openapi";

type MyNotifications = components["schemas"]["MyNotifications"];
type NotificationRead = components["schemas"]["NotificationRead"];

const POLL_MS = 60_000;

// Iconos por tipo genérico de la base; cada proyecto añade los suyos.
const KIND_ICONS: Record<string, string> = {
  system: "🔔",
  promo: "📣",
};

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("es-MX", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

// Estado del push en ESTE navegador, derivado en el cliente (jamás en SSR).
type PushState =
  | { kind: "hidden" } // sin soporte / SSR: no se muestra nada
  | { kind: "offer"; capability: PushCapability } // ready | needs-install
  | { kind: "enabled" }
  | { kind: "busy" };

export function NotificationsBell() {
  const [data, setData] = useState<MyNotifications | null>(null);
  const [open, setOpen] = useState(false);
  const [push, setPush] = useState<PushState>({ kind: "hidden" });
  // Posición vertical del panel en móvil (fixed): borde inferior del botón.
  const [panelTop, setPanelTop] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // El contenedor solo mide lo que ocupa el botón (el panel va fuera de flujo),
  // así que su borde inferior es el punto donde debe empezar el panel.
  const measurePanelTop = useCallback(() => {
    if (rootRef.current) {
      setPanelTop(rootRef.current.getBoundingClientRect().bottom + 8);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      // Solo NO leídas: descartar una la marca leída y desaparece, así el panel
      // nunca acumula miles de avisos. El histórico sigue en la base.
      setData(
        await browserApi<MyNotifications>(
          "/api/v1/notifications/me?limit=30&unread_only=true",
        ),
      );
    } catch {
      // Silencio deliberado: la campana jamás rompe la página que la aloja.
    }
  }, []);

  // Descartar UNA notificación: quitado optimista (fuera de la lista y −1 en el
  // badge) y luego se marca leída en el backend; si falla, se recarga la verdad.
  const dismiss = useCallback(
    async (id: string) => {
      setData((current) =>
        current
          ? {
              ...current,
              unread_count: Math.max(0, current.unread_count - 1),
              items: (current.items ?? []).filter((item) => item.id !== id),
            }
          : current,
      );
      try {
        await browserApi(`/api/v1/notifications/${id}/read`, { method: "POST" });
      } catch {
        void load();
      }
    },
    [load],
  );

  useEffect(() => {
    // Primera carga diferida (callback): sin setState síncrono en el efecto.
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  // Web Push: registrar el SW (idempotente), derivar el estado del navegador
  // y refrescar la campana al instante cuando el SW anuncia un push recibido.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const capability = readPushCapability();
      if (capability === "unsupported" || capability === "denied") return;
      if (capability === "needs-install") {
        if (!cancelled) setPush({ kind: "offer", capability });
        return;
      }
      await ensureServiceWorker();
      const subscription = await currentSubscription();
      if (cancelled) return;
      setPush(subscription ? { kind: "enabled" } : { kind: "offer", capability });
    })();

    function onMessage(event: MessageEvent) {
      if ((event.data as { type?: string } | null)?.type === "notification") {
        void load();
      }
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", onMessage);
    }
    return () => {
      cancelled = true;
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", onMessage);
      }
    };
  }, [load]);

  const activatePush = useCallback(async () => {
    setPush({ kind: "busy" });
    const enabled = await enablePush();
    setPush(
      enabled
        ? { kind: "enabled" }
        : Notification.permission === "denied"
          ? { kind: "hidden" }
          : { kind: "offer", capability: "ready" },
    );
  }, []);

  const deactivatePush = useCallback(async () => {
    setPush({ kind: "busy" });
    await disablePush();
    setPush({ kind: "offer", capability: "ready" });
  }, []);

  // Cierre por clic fuera y por Escape.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    // Recalcular al rotar/redimensionar (cambia el alto del header y la posición
    // del botón, y con ello dónde debe anclarse el panel fijo en móvil).
    function onResize() {
      measurePanelTop();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open, measurePanelTop]);

  const unread = data?.unread_count ?? 0;
  const items = data?.items ?? [];

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
      <button
        type="button"
        aria-label={`Notificaciones${unread > 0 ? `: ${unread} sin leer` : ""}`}
        aria-expanded={open}
        title="Notificaciones"
        onClick={() => {
          const next = !open;
          if (next) {
            measurePanelTop();
            void load();
          }
          setOpen(next);
        }}
        style={{
          position: "relative", display: "inline-flex", alignItems: "center",
          justifyContent: "center", width: 36, height: 36, borderRadius: 12,
          border: "1px solid var(--border)", background: "transparent",
          color: "inherit", fontSize: 16, cursor: "pointer",
        }}
      >
        <span aria-hidden>🔔</span>
        {unread > 0 ? (
          <span
            aria-hidden
            style={{
              position: "absolute", top: -6, right: -6, minWidth: 18, height: 18,
              borderRadius: 999, background: "var(--accent)", color: "var(--on-accent, #fff)",
              fontSize: 10.5, fontWeight: 900, display: "inline-flex",
              alignItems: "center", justifyContent: "center", padding: "0 5px",
              lineHeight: 1,
            }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notificaciones"
          className="notif-panel"
          style={{
            zIndex: 60,
            background: "var(--panel)",
            color: "inherit",
            border: "1px solid var(--border)",
            borderRadius: 14,
            boxShadow: "0 14px 34px -12px rgba(0,0,0,0.35)",
            display: "flex",
            flexDirection: "column",
            ...(panelTop != null ? { "--notif-top": `${panelTop}px` } : {}),
          } as CSSProperties}
        >
          <div
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 14px", borderBottom: "1px solid var(--border)",
              position: "sticky", top: 0, background: "var(--panel)",
            }}
          >
            <b style={{ fontSize: 13, flex: 1 }}>Notificaciones</b>
            {unread > 0 ? (
              <button
                type="button"
                onClick={() =>
                  void (async () => {
                    try {
                      await browserApi("/api/v1/notifications/me/read-all", { method: "POST" });
                      await load();
                    } catch {
                      // best-effort
                    }
                  })()
                }
                style={{
                  border: "none", background: "transparent", color: "inherit",
                  fontSize: 11.5, fontWeight: 800, cursor: "pointer",
                  textDecoration: "underline", padding: 0,
                }}
              >
                Descartar todas
              </button>
            ) : null}
          </div>

          {push.kind !== "hidden" ? (
            <div
              style={{
                display: "flex", flexDirection: "column", gap: 6,
                padding: "10px 14px", borderBottom: "1px solid var(--border)",
                fontSize: 12, color: "var(--tx3)",
              }}
            >
              {push.kind === "offer" && push.capability === "ready" ? (
                <button
                  type="button"
                  onClick={() => void activatePush()}
                  style={{
                    alignSelf: "flex-start", border: "1px solid var(--border)",
                    borderRadius: 9, background: "transparent", color: "inherit",
                    fontSize: 12, fontWeight: 800, cursor: "pointer",
                    padding: "6px 10px",
                  }}
                >
                  🔔 Activar avisos en este dispositivo
                </button>
              ) : null}
              {push.kind === "offer" && push.capability === "needs-install" ? (
                <span>
                  Para recibir avisos en este dispositivo, añade la app a tu
                  pantalla de inicio: toca <b>Compartir</b> y elige{" "}
                  <b>«Añadir a pantalla de inicio»</b>; luego actívalos desde la
                  app instalada.
                </span>
              ) : null}
              {push.kind === "busy" ? <span>Activando avisos…</span> : null}
              {push.kind === "enabled" ? (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  Avisos activos en este dispositivo ✓
                  <button
                    type="button"
                    onClick={() => void deactivatePush()}
                    style={{
                      border: "none", background: "transparent", color: "inherit",
                      fontSize: 11, cursor: "pointer", textDecoration: "underline",
                      padding: 0,
                    }}
                  >
                    desactivar
                  </button>
                </span>
              ) : null}
            </div>
          ) : null}

          {items.length === 0 ? (
            <p style={{ margin: 0, padding: "16px 14px", fontSize: 13, color: "var(--tx3)" }}>
              No tienes notificaciones nuevas.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {items.map((item: NotificationRead) => {
                const content = (
                  <>
                    <span aria-hidden style={{ fontSize: 15, flexShrink: 0 }}>
                      {KIND_ICONS[item.kind] ?? "🔔"}
                    </span>
                    <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <b style={{ fontSize: 13 }}>{item.title}</b>
                      <span style={{ fontSize: 12, color: "var(--tx3)" }}>{item.body}</span>
                      <span style={{ fontSize: 10.5, color: "var(--tx3)", fontWeight: 700 }}>
                        {formatWhen(item.created_at)}
                      </span>
                    </span>
                  </>
                );
                const rowStyle: CSSProperties = {
                  display: "flex", gap: 10, flex: 1, minWidth: 0,
                  color: "inherit", textDecoration: "none",
                };
                // Al tocar el enlace: cerrar el panel y descartar (marcar leída).
                const onNavigate = () => {
                  setOpen(false);
                  void dismiss(item.id);
                };
                const external = item.href?.startsWith("http");
                return (
                  <li
                    key={item.id}
                    style={{
                      display: "flex", gap: 10, padding: "10px 14px",
                      borderBottom: "1px solid var(--border)", fontSize: 13,
                    }}
                  >
                    {item.href ? (
                      external ? (
                        <a
                          href={item.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={onNavigate}
                          style={rowStyle}
                        >
                          {content}
                        </a>
                      ) : (
                        <Link href={item.href} onClick={onNavigate} style={rowStyle}>
                          {content}
                        </Link>
                      )
                    ) : (
                      <div style={rowStyle}>{content}</div>
                    )}
                    <button
                      type="button"
                      aria-label="Descartar notificación"
                      title="Descartar"
                      onClick={() => void dismiss(item.id)}
                      style={{
                        border: "none", background: "transparent", color: "var(--tx3)",
                        fontSize: 16, lineHeight: 1, cursor: "pointer", flexShrink: 0,
                        padding: "0 2px", alignSelf: "flex-start",
                      }}
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
