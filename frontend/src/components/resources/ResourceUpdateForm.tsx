"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { ResourceFormFields } from "@/components/resources/ResourceFormFields";
import { ApiRequestError } from "@/core/api/api-error";
import type { ResourceFormCapability } from "@/core/api/contracts";
import { buildUpdatePayload } from "@/core/resources/resource-form";
import { updateResource } from "@/core/resources/resource-mutation-client";

type FieldErrors = Record<string, string[]>;

const ADMIN_COVERAGE_MESSAGE =
  "No se puede aplicar el cambio porque dejaría la plataforma sin cobertura administrativa.";

function appendError(errors: FieldErrors, field: string, message: string): void {
  errors[field] = [...(errors[field] ?? []), message];
}

function formErrors(
  error: ApiRequestError,
  allowedFields: Set<string>,
): { general: string | null; fields: FieldErrors } {
  if (error.status === 422 && error.body.errors) {
    const fields: FieldErrors = {};
    const general: string[] = [];
    for (const item of error.body.errors) {
      if (item.field && allowedFields.has(item.field)) {
        appendError(fields, item.field, item.message);
      } else {
        general.push(item.message);
      }
    }
    return { general: general.length > 0 ? general.join(" ") : null, fields };
  }

  if (error.status === 409 && error.body.code === "admin_coverage_required") {
    return { general: ADMIN_COVERAGE_MESSAGE, fields: {} };
  }

  if (error.status === 409) {
    return {
      general: "No se pudo guardar porque ya existe un dato equivalente.",
      fields: {},
    };
  }

  return { general: "No se pudo guardar el recurso. Inténtalo nuevamente.", fields: {} };
}

export function ResourceUpdateForm({
  resourceName,
  resourceLabel,
  update,
  mutationUrl,
  initialValues,
}: Readonly<{
  resourceName: string;
  resourceLabel: string;
  update: ResourceFormCapability;
  mutationUrl: string;
  initialValues: Record<string, unknown>;
}>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const listPath = `/resources/${encodeURIComponent(resourceName)}`;
  const allowedFields = new Set(update.fields.map((field) => field.name));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setGeneralError(null);
    setFieldErrors({});

    try {
      const formData = new FormData(event.currentTarget);
      await updateResource(mutationUrl, update.method, buildUpdatePayload(update.fields, formData));
      router.replace(listPath);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.status === 401) {
          router.push("/login");
          return;
        }
        if (error.status === 403 || error.status === 404) {
          router.replace(listPath);
          return;
        }
        const parsed = formErrors(error, allowedFields);
        setGeneralError(parsed.general);
        setFieldErrors(parsed.fields);
      } else {
        setGeneralError("No se pudo guardar el recurso. Inténtalo nuevamente.");
      }
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-label={`Editar ${resourceLabel}`}
      className="max-w-2xl space-y-6 rounded-lg border border-slate-200 bg-white p-6"
    >
      <header>
        <p className="text-sm font-medium text-slate-500">Editar recurso</p>
        <h2 className="mt-1 text-xl font-semibold text-slate-900">Editar {resourceLabel}</h2>
      </header>

      {generalError ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {generalError}
        </div>
      ) : null}

      <ResourceFormFields
        fields={update.fields}
        fieldErrors={fieldErrors}
        initialValues={initialValues}
      />

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando..." : "Guardar"}
        </Button>
        <button
          type="button"
          onClick={() => router.replace(listPath)}
          disabled={pending}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
