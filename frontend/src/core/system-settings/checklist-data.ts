import "server-only";

import { cookies } from "next/headers";

import { ApiRequestError } from "@/core/api/api-error";
import { serverApi } from "@/core/api/server-client";

import { parseSetupChecklist, type SetupChecklist } from "./setup-checklist.ts";

// Data layer SERVER-ONLY del checklist de puesta en marcha. ``null`` degrada en
// silencio (sin permiso system_settings:read, error transitorio…): el banner
// simplemente no se muestra — nunca bloquea el inicio.

export async function getSetupChecklist(): Promise<SetupChecklist | null> {
  const cookie = (await cookies()).toString();
  try {
    const payload = await serverApi<unknown>(
      "/api/v1/system-settings/setup-checklist",
      { cookie },
    );
    return parseSetupChecklist(payload);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      // La página ya exige sesión; un 401 aquí es una carrera de expiración.
      return null;
    }
    return null;
  }
}
