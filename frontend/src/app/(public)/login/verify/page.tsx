"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { ApiRequestError } from "@/core/api/api-error";
import { verifyLogin } from "@/core/auth/public-auth-client";
import { AuthAlert, PublicAuthShell } from "@/features/auth/PublicAuthShell";

/**
 * Aterrizaje del ENLACE de verificación de login. Canjea el token de la URL por
 * la sesión — sólo funciona en el MISMO navegador que inició el login (el reto
 * viaja en una cookie httponly): un enlace reenviado a otro dispositivo no crea
 * sesión ahí, por diseño.
 */
function VerifyLanding() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);
  // Estado DERIVADO (no en el efecto): un enlace sin token es inválido de entrada.
  const missingToken = !token;

  useEffect(() => {
    if (attempted.current || !token) return;
    attempted.current = true;
    verifyLogin(token)
      .then(() => {
        router.replace("/");
        router.refresh();
      })
      .catch((caught: unknown) => {
        if (caught instanceof ApiRequestError) {
          setError(
            `${caught.body.message} Asegúrate de abrir el enlace en el mismo ` +
              "navegador donde iniciaste sesión.",
          );
          return;
        }
        setError("No se pudo verificar el inicio de sesión.");
      });
  }, [router, token]);

  const displayError = missingToken
    ? "El enlace no es válido: falta el token de verificación."
    : error;

  return (
    <div className="space-y-4">
      {displayError ? (
        <>
          <AuthAlert tone="danger">{displayError}</AuthAlert>
          <p className="text-center text-sm">
            <Link href="/login" className="font-medium text-[var(--accent-tx)] hover:underline">
              Volver a iniciar sesión
            </Link>
          </p>
        </>
      ) : (
        <p className="text-center text-sm text-[var(--tx2)]">Verificando el inicio de sesión…</p>
      )}
    </div>
  );
}

export default function LoginVerifyPage() {
  return (
    <PublicAuthShell
      title="Confirmar inicio de sesión"
      description="Un paso más: validamos el enlace que recibiste por correo."
    >
      <Suspense>
        <VerifyLanding />
      </Suspense>
    </PublicAuthShell>
  );
}
