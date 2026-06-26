"use client";

import { KeyboardEvent, useEffect, useId, useRef } from "react";

import { Button } from "@/components/ui/Button";
import type { ActionConfirmation } from "@/core/api/contracts";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

/**
 * Diálogo de confirmación accesible para acciones de recurso.
 *
 * - ``role="dialog"`` + ``aria-modal`` con título y mensaje asociados;
 * - foco inicial en Cancelar (opción segura), foco atrapado mientras está abierto;
 * - Escape cancela cuando no hay mutación en curso;
 * - restaura el foco al disparador al cerrar;
 * - confirmar deshabilitado durante ``pending`` (evita doble submit);
 * - lo destructivo se marca con texto, no solo con color;
 * - muestra un error general seguro, nunca detalle técnico.
 *
 * No decide la acción: recibe la confirmación del contrato y delega en callbacks.
 */
export function ResourceActionConfirmDialog({
  confirmation,
  pending,
  error,
  onConfirm,
  onCancel,
}: Readonly<{
  confirmation: ActionConfirmation;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      if (!pending) {
        event.preventDefault();
        onCancel();
      }
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) {
      return;
    }
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
    );
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onKeyDown={onKeyDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="w-full max-w-md space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-lg"
      >
        <h2 id={titleId} className="text-lg font-semibold text-slate-900">
          {confirmation.title}
        </h2>
        <p id={messageId} className="text-sm text-slate-600">
          {confirmation.message}
        </p>
        {confirmation.destructive ? (
          <p className="text-sm font-medium text-red-700">Acción destructiva.</p>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancelar
          </button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={
              confirmation.destructive
                ? "bg-red-600 hover:bg-red-500"
                : undefined
            }
          >
            {pending ? "Procesando..." : confirmation.confirm_label}
          </Button>
        </div>
      </div>
    </div>
  );
}
