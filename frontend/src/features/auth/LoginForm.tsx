"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ApiRequestError } from "@/core/api/api-error";
import { browserApi } from "@/core/api/browser-client";
import { AuthAlert, AuthLabel } from "@/features/auth/PublicAuthShell";

// Caja de campo del diseño (LOGIN, MP-CTRL-0127): icono + input transparente en un contenedor
// redondeado. SÓLO presentación; los atributos del input (name/type/autoComplete/required) se
// conservan idénticos, así el envío por FormData no cambia.
const FIELD_BOX =
  "flex items-center gap-2.5 rounded-[13px] border border-[var(--border2)] bg-[var(--bg2)] px-3 py-2.5 transition focus-within:border-[var(--accent-bd)]";
const FIELD_INPUT =
  "flex-1 border-0 bg-transparent text-sm text-[var(--tx)] outline-none placeholder:text-[var(--tx3)]";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    try {
      await browserApi("/api/v1/auth/login", {
        method: "POST",
        body: { email, password },
      });

      startTransition(() => {
        router.replace("/");
        router.refresh();
      });
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        setError(caught.body.message);
        return;
      }
      setError("No se pudo iniciar sesión");
    }
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div className="space-y-1.5">
        <AuthLabel htmlFor="email">Correo electrónico</AuthLabel>
        <div className={FIELD_BOX}>
          <svg
            aria-hidden="true"
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--tx3)"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="5" width="18" height="14" rx="2.5" />
            <path d="M3.5 6.5L12 13l8.5-6.5" />
          </svg>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="doctor@ejemplo.com"
            className={FIELD_INPUT}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <AuthLabel htmlFor="password">Contraseña</AuthLabel>
        <div className={FIELD_BOX}>
          <svg
            aria-hidden="true"
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--tx3)"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="4" y="10" width="16" height="11" rx="2.5" />
            <path d="M8 10V7a4 4 0 018 0v3" />
          </svg>
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            placeholder="••••••••"
            className={FIELD_INPUT}
          />
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-pressed={showPassword}
            aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            title={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            className="flex shrink-0 text-[var(--tx3)] transition hover:text-[var(--tx2)]"
          >
            {showPassword ? (
              <svg
                aria-hidden="true"
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                <circle cx="12" cy="12" r="3" />
                <path d="M3 3l18 18" />
              </svg>
            ) : (
              <svg
                aria-hidden="true"
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      </div>
      {error ? (
        <AuthAlert tone="danger" role="alert">
          {error}
        </AuthAlert>
      ) : null}
      <button
        type="submit"
        disabled={isPending}
        className="mt-1 flex w-full items-center justify-center gap-2 rounded-[14px] bg-[var(--accent)] px-4 py-3 text-[14.5px] font-semibold text-[var(--on-accent)] shadow-[var(--soft)] transition hover:brightness-105 disabled:opacity-60"
      >
        {isPending ? "Ingresando..." : "Ingresar"}
        <svg
          aria-hidden="true"
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>
    </form>
  );
}
