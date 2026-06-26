import "server-only";

import { serverApi } from "@/core/api/server-client";
import type { BootstrapStatusRead } from "@/core/api/contracts";

export function getBootstrapStatus(): Promise<BootstrapStatusRead> {
  return serverApi<BootstrapStatusRead>("/api/v1/bootstrap/status", {
    cache: "no-store",
  });
}
