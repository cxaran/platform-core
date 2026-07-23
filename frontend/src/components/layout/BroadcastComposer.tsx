"use client";

// Compositor de difusiones dentro del panel de la campana. Visible SOLO con el
// permiso notifications:send (la proyección del backend manda; aquí solo se
// evita ofrecer un botón que daría 403). Colapsado por defecto para no estorbar
// la lista de avisos del propio usuario.

import { FormEvent, useState } from "react";

import { ApiRequestError } from "@/core/api/api-error";
import { useSession } from "@/core/auth/SessionProvider";
import {
  sendBroadcast,
  type BroadcastAudience,
} from "@/core/notifications/broadcast-client";

const AUDIENCES: Array<{ value: BroadcastAudience; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "customers", label: "Usuarios sin roles" },
  { value: "staff", label: "Personal (con roles)" },
];

const inputStyle = {
  width: "100%", border: "1px solid var(--border)", borderRadius: 9,
  background: "transparent", color: "inherit", fontSize: 12.5,
  padding: "7px 9px",
} as const;

export function BroadcastComposer({ onSent }: Readonly<{ onSent?: () => void }>) {
  const { hasPermission } = useSession();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<BroadcastAudience>("all");
  const [linkUrl, setLinkUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  if (!hasPermission("notifications:send")) {
    return null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const result = await sendBroadcast({ title, body, audience, link_url: linkUrl });
      setTitle("");
      setBody("");
      setLinkUrl("");
      setOpen(false);
      setNotice({ tone: "ok", text: `Aviso enviado a ${result.created} usuario(s).` });
      onSent?.();
    } catch (error) {
      const message =
        error instanceof ApiRequestError
          ? (error.body.errors ?? []).map((item) => item.message).join(" ") || error.body.message
          : "No se pudo enviar el aviso.";
      setNotice({ tone: "error", text: message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: "flex", flexDirection: "column", gap: 8,
        padding: "10px 14px", borderBottom: "1px solid var(--border)",
        fontSize: 12, color: "var(--tx3)",
      }}
    >
      {!open ? (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setNotice(null);
          }}
          style={{
            alignSelf: "flex-start", border: "1px solid var(--border)",
            borderRadius: 9, background: "transparent", color: "inherit",
            fontSize: 12, fontWeight: 800, cursor: "pointer", padding: "6px 10px",
          }}
        >
          📣 Enviar aviso
        </button>
      ) : (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <b style={{ color: "var(--tx)", fontSize: 12.5 }}>Difundir aviso</b>
          <input
            aria-label="Título del aviso"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Título"
            maxLength={140}
            required
            style={inputStyle}
          />
          <textarea
            aria-label="Mensaje del aviso"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Mensaje"
            maxLength={500}
            required
            rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
          />
          <select
            aria-label="Audiencia"
            value={audience}
            onChange={(event) => setAudience(event.target.value as BroadcastAudience)}
            style={inputStyle}
          >
            {AUDIENCES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            aria-label="Enlace opcional"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            placeholder="Enlace opcional (/ruta interna o https://…)"
            maxLength={500}
            style={inputStyle}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="submit"
              disabled={busy}
              style={{
                border: "1px solid var(--border)", borderRadius: 9,
                background: "var(--accent)", color: "var(--accent-tx, #fff)",
                fontSize: 12, fontWeight: 800, cursor: "pointer", padding: "6px 12px",
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? "Enviando…" : "Enviar"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                border: "1px solid var(--border)", borderRadius: 9,
                background: "transparent", color: "inherit", fontSize: 12,
                cursor: "pointer", padding: "6px 12px",
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
      {notice ? (
        <span
          role={notice.tone === "error" ? "alert" : "status"}
          style={{ color: notice.tone === "error" ? "var(--danger, #c00)" : "inherit" }}
        >
          {notice.text}
        </span>
      ) : null}
    </div>
  );
}
