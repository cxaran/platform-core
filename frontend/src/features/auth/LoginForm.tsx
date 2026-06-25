"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ApiRequestError } from "@/core/api/api-error";
import { browserApi } from "@/core/api/browser-client";
import { Button } from "@/components/ui/Button";
import { FieldError } from "@/components/ui/FieldError";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
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
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="email">
          Email
        </label>
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="password">
          Contraseña
        </label>
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950"
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <FieldError message={error} />
      <Button className="w-full" disabled={isPending} type="submit">
        {isPending ? "Ingresando..." : "Ingresar"}
      </Button>
    </form>
  );
}
