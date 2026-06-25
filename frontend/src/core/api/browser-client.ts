"use client";

import { ApiRequestInit, requestJson } from "./request";

export function browserApi<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  return requestJson<T>(path, {
    ...init,
    credentials: "include",
  });
}
