"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { logout } from "@/core/auth/account-mutation-client";

/**
 * Cierre de sesión dentro de "Mi cuenta": el logout llama al backend (borra la cookie httponly) y
 * redirige a login; cualquier error igualmente termina en login para no dejar al usuario atrapado.
 */
export function AccountLogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onLogout() {
    if (pending) return;
    setPending(true);
    try {
      await logout();
    } catch {
      // El logout es idempotente desde la perspectiva del usuario: ante cualquier
      // error igual se le envía a login.
    }
    router.replace("/login");
  }

  return (
    <section className="rounded-[16px] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[var(--soft)]">
      <h2 className="text-base font-semibold text-[var(--tx)]">Sesión</h2>
      <p className="mt-1 text-sm text-[var(--tx2)]">Cierra tu sesión en este dispositivo.</p>
      <button
        type="button"
        onClick={onLogout}
        disabled={pending}
        className="mt-3 inline-flex items-center gap-2 rounded-[11px] border border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-sm font-medium text-[var(--tx2)] transition hover:border-[var(--danger)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 17l5-5-5-5M20 12H9M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
        </svg>
        {pending ? "Cerrando…" : "Cerrar sesión"}
      </button>
    </section>
  );
}
