import "server-only";

import type { components } from "@/generated/openapi";
import { serverApi } from "@/core/api/server-client";

export type AuthPolicy = components["schemas"]["AuthPolicyRead"];

const SAFE_DEFAULT: AuthPolicy = {
  registration_enabled: false,
  password_reset_enabled: false,
};

/**
 * Política pública de auth resuelta en servidor. El frontend no infiere esto de su
 * propia configuración: lo consume del backend. Ante cualquier error se asume el
 * default conservador (todo deshabilitado) para no exponer flujos no soportados.
 */
export async function getAuthPolicy(): Promise<AuthPolicy> {
  try {
    return await serverApi<AuthPolicy>("/api/v1/auth/policy");
  } catch {
    return SAFE_DEFAULT;
  }
}
