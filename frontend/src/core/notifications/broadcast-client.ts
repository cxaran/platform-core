"use client";

// Difusión de avisos del administrador (POST /notifications/broadcast, permiso
// notifications:send). El backend valida título/cuerpo/enlace y audita con
// nombres de campos; los errores llegan por el envelope estándar ya traducido.

import { browserApi } from "@/core/api/browser-client";

export type BroadcastAudience = "all" | "customers" | "staff";

export type BroadcastInput = {
  title: string;
  body: string;
  audience: BroadcastAudience;
  link_url?: string | null;
};

export type BroadcastResult = {
  created: number;
  audience: BroadcastAudience;
};

export function sendBroadcast(input: BroadcastInput): Promise<BroadcastResult> {
  return browserApi<BroadcastResult>("/api/v1/notifications/broadcast", {
    method: "POST",
    body: {
      title: input.title,
      body: input.body,
      audience: input.audience,
      link_url: input.link_url?.trim() || null,
    },
  });
}
