import "server-only";

import { ApiRequestInit, requestJson } from "./request";

function backendInternalUrl(): string {
  return process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000";
}

export function serverApi<T>(
  path: string,
  init: ApiRequestInit & { cookie?: string } = {},
): Promise<T> {
  const { cookie, ...requestInit } = init;
  const headers = new Headers(requestInit.headers);
  if (cookie) {
    headers.set("cookie", cookie);
  }

  return requestJson<T>(new URL(path, backendInternalUrl()).toString(), {
    ...requestInit,
    headers,
    cache: "no-store",
  });
}
