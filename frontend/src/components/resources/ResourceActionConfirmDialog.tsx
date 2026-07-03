"use client";

import { FormEvent, KeyboardEvent, useEffect, useId, useRef } from "react";

import { Button } from "@/components/ui/Button";
import { ResourceFormFields } from "@/components/resources/ResourceFormFields";
import type {
  ActionConfirmation,
  ResourceFormFieldCapability,
} from "@/core/api/contracts";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

type FieldErrors = Record<string, string[]>;

/**
 * Diálogo de confirmación accesible para acciones de recurso.
 *
 * - ``role="dialog"`` + ``aria-modal`` con título y mensaje asociados;
 * - foco inicial en el primer campo cuando hay formulario, o en Cancelar (opción
 *   segura) cuando es sólo confirmación; foco atrapado mientras está abierto;
 * - Escape cancela cuando no hay mutación en curso;
 * - restaura el foco al disparador al cerrar;
 * - confirmar deshabilitado durante ``pending`` (evita doble submit);
 * - lo destructivo se marca con texto, no solo con color;
 * - muestra un error general seguro y, cuando hay ``input_schema``, errores por campo.
 *
 * Cuando la acción declara ``input_schema`` (``fields``) el confirmar es el submit del
 * formulario y entrega los datos capturados vía ``onConfirm(formData)``. No decide la
 * acción: recibe el contrato y delega en callbacks; el backend revalida todo.
 */
export function ResourceActionConfirmDialog({
  confirmation,
  fields = [],
  fieldErrors = {},
  pending,
  error,
  onConfirm,
  onCancel,
}: Readonly<{
  confirmation: ActionConfirmation;
  fields?: readonly ResourceFormFieldCapability[];
  fieldErrors?: FieldErrors;
  pending: boolean;
  error: string | null;
  onConfirm: (formData?: FormData) => void;
  onCancel: () => void;
}>) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();
  const hasFields = fields.length > 0;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // En formularios el foco inicial va al primer campo (captura de datos); en una
    // confirmación simple va a Cancelar (la opción segura).
    if (hasFields && dialogRef.current) {
      const firstField = dialogRef.current.querySelector<HTMLElement>(
        "input,textarea,select",
      );
      (firstField ?? cancelRef.current)?.focus();
    } else {
      cancelRef.current?.focus();
    }
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [hasFields]);

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

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }
    onConfirm(new FormData(event.currentTarget));
  }

  const header = (
    <>
      <h2 id={titleId} className="text-lg font-semibold text-slate-900">
        {confirmation.title}
      </h2>
      <p id={messageId} className="text-sm text-slate-600">
        {confirmation.message}
      </p>
      {confirmation.destructive ? (
        <p className="text-sm font-medium text-red-700">Acción destructiva.</p>
      ) : null}
    </>
  );

  const generalError = error ? (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      {error}
    </div>
  ) : null;

  const actions = (
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
        type={hasFields ? "submit" : "button"}
        onClick={hasFields ? undefined : () => onConfirm()}
        disabled={pending}
        className={
          confirmation.destructive ? "bg-red-600 hover:bg-red-500" : undefined
        }
      >
        {pending ? "Procesando..." : confirmation.confirm_label}
      </Button>
    </div>
  );

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
        {hasFields ? (
          <form className="space-y-4" onSubmit={onSubmit} noValidate>
            {header}
            <ResourceFormFields fields={fields} fieldErrors={fieldErrors} />
            {generalError}
            {actions}
          </form>
        ) : (
          <>
            {header}
            {generalError}
            {actions}
          </>
        )}
      </div>
    </div>
  );
}
