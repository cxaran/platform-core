"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { ResourceActionConfirmDialog } from "@/components/resources/ResourceActionConfirmDialog";
import { ApiRequestError } from "@/core/api/api-error";
import type { ResourceActionCapability } from "@/core/api/contracts";
import {
  actionErrorMessage,
  actionInputFields,
  buildActionPayload,
  isActionEnabled,
  shouldOpenDialog,
} from "@/core/resources/resource-action";
import { executeAction } from "@/core/resources/resource-action-client";

const GENERIC_ERROR = "No se pudo completar la acción. Inténtalo nuevamente.";

type FieldErrors = Record<string, string[]>;

/**
 * Separa el ErrorResponse 422 en errores por campo (sólo los declarados en el
 * formulario de la acción) y un error general seguro para el resto.
 */
function parseFieldErrors(
  error: ApiRequestError,
  allowed: Set<string>,
): { general: string | null; fields: FieldErrors } {
  if (error.status === 422 && error.body.errors) {
    const fields: FieldErrors = {};
    const general: string[] = [];
    for (const item of error.body.errors) {
      if (item.field && allowed.has(item.field)) {
        fields[item.field] = [...(fields[item.field] ?? []), item.message];
      } else {
        general.push(item.message);
      }
    }
    return { general: general.length > 0 ? general.join(" ") : null, fields };
  }
  return { general: actionErrorMessage(error.status, error.body.code), fields: {} };
}

/**
 * Controles de acción de una fila, guiados por capability. No hay botones ni reglas
 * hardcodeadas: cada acción viene del contrato. Las acciones con confirmación
 * requerida o con ``input_schema`` abren el diálogo accesible y no ejecutan request
 * antes de confirmar. Las acciones con ``input_schema`` capturan datos en un
 * formulario y envían sólo los campos declarados (allowlist). El backend sigue siendo
 * la autoridad (supervivencia, invalidación, permisos, estado).
 */
const DISABLED_HINT = "No aplica al estado actual";

export function ResourceRowActions({
  placeholder,
  id,
  actions,
  item,
}: Readonly<{
  placeholder: string;
  id: string;
  actions: ResourceActionCapability[];
  item: Record<string, unknown>;
}>) {
  const router = useRouter();
  const [activeAction, setActiveAction] = useState<ResourceActionCapability | null>(null);
  const [pending, setPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [dialogFieldErrors, setDialogFieldErrors] = useState<FieldErrors>({});
  const [inlineError, setInlineError] = useState<string | null>(null);

  async function perform(
    action: ResourceActionCapability,
    payload: Record<string, unknown> | undefined,
    onError: (message: string) => void,
    onDone: () => void,
  ) {
    setPending(true);
    try {
      await executeAction(action, placeholder, id, payload);
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
        // Errores por campo sólo cuando la acción captura datos (input_schema).
        if (error.status === 422 && actionInputFields(action).length > 0) {
          const allowed = new Set(actionInputFields(action).map((f) => f.name));
          const parsed = parseFieldErrors(error, allowed);
          setDialogFieldErrors(parsed.fields);
          setDialogError(parsed.general);
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
    if (shouldOpenDialog(action)) {
      setDialogError(null);
      setDialogFieldErrors({});
      setActiveAction(action);
      return;
    }
    void perform(action, undefined, setInlineError, () => undefined);
  }

  function onConfirm(formData?: FormData) {
    if (!activeAction || pending) {
      return;
    }
    const payload =
      actionInputFields(activeAction).length > 0 && formData
        ? buildActionPayload(activeAction, formData)
        : undefined;
    void perform(activeAction, payload, setDialogError, () => {
      setActiveAction(null);
      setDialogFieldErrors({});
    });
  }

  function onCancel() {
    if (pending) {
      return;
    }
    setActiveAction(null);
    setDialogError(null);
    setDialogFieldErrors({});
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {actions.map((action) => {
          // enabled_when es guía de UI: si no se cumple, el botón se ve deshabilitado
          // (aria-disabled + tooltip) y el click se ignora. El backend revalida igual.
          const enabled = isActionEnabled(action, item);
          return (
            <button
              key={action.name}
              type="button"
              aria-disabled={enabled ? undefined : true}
              title={enabled ? undefined : DISABLED_HINT}
              onClick={() => {
                if (enabled) {
                  onActionClick(action);
                }
              }}
              className={`rounded-full px-2.5 py-1 text-[12.5px] font-medium whitespace-nowrap transition ${
                action.danger
                  ? "text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]"
                  : "text-[var(--accent-tx)] hover:bg-[var(--accent-dim)]"
              } ${enabled ? "" : "cursor-not-allowed opacity-50 hover:bg-transparent"}`}
            >
              {action.label}
            </button>
          );
        })}
      </div>
      {inlineError ? (
        <p role="alert" className="mt-1 text-sm text-[var(--danger)]">
          {inlineError}
        </p>
      ) : null}
      {activeAction && activeAction.confirmation ? (
        <ResourceActionConfirmDialog
          confirmation={activeAction.confirmation}
          fields={actionInputFields(activeAction)}
          fieldErrors={dialogFieldErrors}
          pending={pending}
          error={dialogError}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      ) : null}
    </>
  );
}
