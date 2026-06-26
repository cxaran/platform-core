"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ResourceActionConfirmDialog } from "@/components/resources/ResourceActionConfirmDialog";
import { ApiRequestError } from "@/core/api/api-error";
import type { ResourceActionCapability } from "@/core/api/contracts";
import {
  actionErrorMessage,
  actionRequiresConfirmation,
} from "@/core/resources/resource-action";
import { executeAction } from "@/core/resources/resource-action-client";

const GENERIC_ERROR = "No se pudo completar la acción. Inténtalo nuevamente.";

/**
 * Controles de acción de una fila, guiados por capability. No hay botones ni reglas
 * hardcodeadas: cada acción viene del contrato. Las acciones con confirmación
 * requerida abren el diálogo accesible y no ejecutan request antes de confirmar.
 * El backend sigue siendo la autoridad (supervivencia, invalidación, permisos).
 */
export function ResourceRowActions({
  placeholder,
  id,
  actions,
}: Readonly<{
  placeholder: string;
  id: string;
  actions: ResourceActionCapability[];
}>) {
  const router = useRouter();
  const [activeAction, setActiveAction] = useState<ResourceActionCapability | null>(null);
  const [pending, setPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);

  async function perform(
    action: ResourceActionCapability,
    onError: (message: string) => void,
    onDone: () => void,
  ) {
    setPending(true);
    try {
      await executeAction(action, placeholder, id);
      setPending(false);
      onDone();
      router.refresh();
    } catch (error) {
      setPending(false);
      if (error instanceof ApiRequestError) {
        if (error.status === 401) {
          router.push("/login");
          return;
        }
        if (error.status === 403 || error.status === 404) {
          onDone();
          router.refresh();
          return;
        }
        onError(actionErrorMessage(error.status, error.body.code));
        return;
      }
      onError(GENERIC_ERROR);
    }
  }

  function onActionClick(action: ResourceActionCapability) {
    if (pending) {
      return;
    }
    setInlineError(null);
    if (actionRequiresConfirmation(action)) {
      setDialogError(null);
      setActiveAction(action);
      return;
    }
    void perform(action, setInlineError, () => undefined);
  }

  function onConfirm() {
    if (!activeAction || pending) {
      return;
    }
    void perform(activeAction, setDialogError, () => setActiveAction(null));
  }

  function onCancel() {
    if (pending) {
      return;
    }
    setActiveAction(null);
    setDialogError(null);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        {actions.map((action) => (
          <button
            key={action.name}
            type="button"
            onClick={() => onActionClick(action)}
            className={`text-sm font-medium underline-offset-2 hover:underline ${
              action.danger ? "text-red-700 hover:text-red-800" : "text-slate-700 hover:text-slate-900"
            }`}
          >
            {action.label}
          </button>
        ))}
      </div>
      {inlineError ? (
        <p role="alert" className="mt-1 text-sm text-red-700">
          {inlineError}
        </p>
      ) : null}
      {activeAction && activeAction.confirmation ? (
        <ResourceActionConfirmDialog
          confirmation={activeAction.confirmation}
          pending={pending}
          error={dialogError}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      ) : null}
    </>
  );
}
