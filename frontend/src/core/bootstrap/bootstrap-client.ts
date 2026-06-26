"use client";

import { browserApi } from "@/core/api/browser-client";
import type {
  BootstrapCatalogRead,
  BootstrapInitializeRead,
  BootstrapInitializeRequest,
} from "@/core/api/contracts";

function tokenHeaders(token: string): HeadersInit | undefined {
  const trimmed = token.trim();
  return trimmed ? { "X-Bootstrap-Token": trimmed } : undefined;
}

export function getBootstrapCatalog(token: string): Promise<BootstrapCatalogRead> {
  return browserApi<BootstrapCatalogRead>("/api/v1/bootstrap/catalog", {
    headers: tokenHeaders(token),
    cache: "no-store",
  });
}

export function initializeBootstrap(
  payload: BootstrapInitializeRequest,
  token: string,
): Promise<BootstrapInitializeRead> {
  return browserApi<BootstrapInitializeRead>("/api/v1/bootstrap/initialize", {
    method: "POST",
    headers: tokenHeaders(token),
    body: payload,
  });
}
