"use client";

import { browserApi } from "@/core/api/browser-client";

/** Solicita un token de registro por email (respuesta anti-enumeración). */
export function requestRegistration(email: string): Promise<unknown> {
  return browserApi<unknown>("/api/v1/auth/register/request", {
    method: "POST",
    body: { email },
  });
}

/** Completa el registro con el token recibido por correo. */
export function completeRegistration(payload: {
  first_name: string;
  last_name: string;
  email: string;
  token: string;
  password: string;
  confirm_password: string;
}): Promise<unknown> {
  return browserApi<unknown>("/api/v1/auth/register/complete", {
    method: "POST",
    body: payload,
  });
}

/** Solicita recuperación de contraseña (respuesta anti-enumeración). */
export function requestPasswordReset(email: string): Promise<unknown> {
  return browserApi<unknown>("/api/v1/auth/password/forgot", {
    method: "POST",
    body: { email },
  });
}

/** Restablece la contraseña con el token recibido por correo. */
export function resetPassword(payload: {
  email: string;
  token: string;
  password: string;
  confirm_password: string;
}): Promise<unknown> {
  return browserApi<unknown>("/api/v1/auth/password/reset", {
    method: "POST",
    body: payload,
  });
}
