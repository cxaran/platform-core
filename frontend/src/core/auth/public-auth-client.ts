"use client";

import { browserApi } from "@/core/api/browser-client";

/** Desenlace del login: sesión creada o reto de verificación por correo. */
export type LoginOutcome = {
  message: string;
  verification_required?: boolean;
  verification_mode?: "code" | "link" | null;
};

/** Inicia sesión; con la verificación activa el backend responde el reto en vez de la cookie. */
export function login(email: string, password: string): Promise<LoginOutcome> {
  return browserApi<LoginOutcome>("/api/v1/auth/login", {
    method: "POST",
    body: { email, password },
  });
}

/** Canjea el código/token del reto por la sesión (misma cookie de navegador del login). */
export function verifyLogin(code: string): Promise<LoginOutcome> {
  return browserApi<LoginOutcome>("/api/v1/auth/login/verify", {
    method: "POST",
    body: { code },
  });
}

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

/** Desbloquea una cuenta bloqueada por intentos fallidos con el token recibido por correo. */
export function unlockAccount(token: string): Promise<unknown> {
  return browserApi<unknown>("/api/v1/auth/unlock", {
    method: "POST",
    body: { token },
  });
}
