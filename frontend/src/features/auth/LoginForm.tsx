"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ApiRequestError } from "@/core/api/api-error";
import { login, verifyLogin } from "@/core/auth/public-auth-client";
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
  // Segundo paso por correo (política del sistema): tras credenciales válidas el
  // backend puede pedir verificación en vez de crear la sesión.
  const [verification, setVerification] = useState<{
    mode: "code" | "link";
    message: string;
  } | null>(null);

  function finishLogin() {
    startTransition(() => {
      router.replace("/");
      router.refresh();
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    try {
      const outcome = await login(email, password);
      if (outcome.verification_required && outcome.verification_mode) {
        setVerification({ mode: outcome.verification_mode, message: outcome.message });
        return;
      }
      finishLogin();
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        setError(caught.body.message);
        return;
      }
      setError("No se pudo iniciar sesión");
    }
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    try {
      await verifyLogin(code);
      finishLogin();
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        setError(caught.body.message);
        return;
      }
      setError("No se pudo verificar el inicio de sesión");
    }
  }

  if (verification) {
    return (
      <form className="space-y-4" onSubmit={onVerify}>
        <p className="text-sm text-[var(--tx2)]">{verification.message}</p>
        {verification.mode === "code" ? (
          <div className="space-y-1.5">
            <AuthLabel htmlFor="code">Código de verificación</AuthLabel>
            <div className={FIELD_BOX}>
              <input
                id="code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                autoFocus
                maxLength={6}
                placeholder="000000"
                className={`${FIELD_INPUT} tracking-[0.3em]`}
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-[var(--tx3)]">
            Abre el enlace del correo EN ESTE navegador para completar el inicio de
            sesión. Puedes cerrar esta pestaña.
          </p>
        )}
        {error ? <AuthAlert tone="danger">{error}</AuthAlert> : null}
        {verification.mode === "code" ? (
          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-[13px] bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--on-accent)] shadow-[var(--soft)] transition hover:brightness-105 disabled:opacity-60"
          >
            {isPending ? "Verificando…" : "Verificar"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setVerification(null);
            setError(null);
          }}
          className="w-full text-center text-sm text-[var(--tx3)] transition hover:text-[var(--tx2)]"
        >
          Volver a iniciar sesión
        </button>
      </form>
    );
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
