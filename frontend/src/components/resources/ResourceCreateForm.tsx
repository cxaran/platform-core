"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { ResourceFormFields } from "@/components/resources/ResourceFormFields";
import { ApiRequestError } from "@/core/api/api-error";
import type { ResourceFormCapability } from "@/core/api/contracts";
import { buildCreatePayload, buildMultipartPayload } from "@/core/resources/resource-form";
import { createResource } from "@/core/resources/resource-mutation-client";

/** Tamaño legible (KB/MB) para los textos de ayuda del campo de archivo. */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
}

type FieldErrors = Record<string, string[]>;

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
    return {
      general: general.length > 0 ? general.join(" ") : null,
      fields,
    };
  }

  if (error.status === 409) {
    return { general: "No se pudo crear el recurso porque ya existe un dato equivalente.", fields: {} };
  }

  return { general: "No se pudo crear el recurso. Inténtalo nuevamente.", fields: {} };
}

export function ResourceCreateForm({
  resourceName,
  resourceLabel,
  create,
}: Readonly<{
  resourceName: string;
  resourceLabel: string;
  create: ResourceFormCapability;
}>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const listPath = `/resources/${encodeURIComponent(resourceName)}`;
  const fileField = create.transport === "multipart" ? create.file_field ?? null : null;
  const allowedFields = new Set(create.fields.map((field) => field.name));
  if (fileField) {
    allowedFields.add(fileField.name);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setGeneralError(null);
    setFieldErrors({});

    try {
      const formData = new FormData(event.currentTarget);

      if (fileField) {
        // Validación cliente del archivo (el backend revalida tipo y tamaño en cada carga).
        const file = formData.get(fileField.name);
        const hasFile = file instanceof File && file.size > 0;
        if (!hasFile) {
          if (fileField.required) {
            setFieldErrors({ [fileField.name]: ["Selecciona un archivo."] });
            setPending(false);
            return;
          }
        } else if (file.size > fileField.max_size_bytes) {
          setFieldErrors({
            [fileField.name]: [
              `El archivo supera el tamaño máximo (${formatBytes(fileField.max_size_bytes)}).`,
            ],
          });
          setPending(false);
          return;
        }
      }

      if (fileField) {
        await createResource(create, buildMultipartPayload(create.fields, formData, fileField));
      } else {
        await createResource(create, buildCreatePayload(create.fields, formData));
      }
      router.replace(listPath);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.status === 401) {
          router.push("/login");
          return;
        }
        if (error.status === 403) {
          router.replace(listPath);
          return;
        }
        const parsed = formErrors(error, allowedFields);
        setGeneralError(parsed.general);
        setFieldErrors(parsed.fields);
      } else {
        setGeneralError("No se pudo crear el recurso. Inténtalo nuevamente.");
      }
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-6 rounded-lg border border-slate-200 bg-white p-6">
      <header>
        <p className="text-sm font-medium text-slate-500">Nuevo recurso</p>
        <h2 className="mt-1 text-xl font-semibold text-slate-900">Crear {resourceLabel}</h2>
      </header>

      {generalError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {generalError}
        </div>
      ) : null}

      {fileField ? (
        <div>
          <label htmlFor={fileField.name} className="block text-sm font-medium text-slate-900">
            {fileField.label}
          </label>
          <input
            id={fileField.name}
            name={fileField.name}
            type="file"
            required={fileField.required}
            accept={fileField.accepted_mime_types.join(",") || undefined}
            aria-describedby={
              fieldErrors[fileField.name]?.length ? `${fileField.name}-error` : undefined
            }
            className="mt-1 block w-full text-sm text-slate-900 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-800"
          />
          <p className="mt-1 text-sm text-slate-500">
            Tamaño máximo {formatBytes(fileField.max_size_bytes)}.
            {fileField.accepted_mime_types.length > 0
              ? ` Tipos permitidos: ${fileField.accepted_mime_types.join(", ")}.`
              : null}
          </p>
          {fieldErrors[fileField.name]?.length ? (
            <p id={`${fileField.name}-error`} className="mt-1 text-sm text-red-600">
              {fieldErrors[fileField.name].join(" ")}
            </p>
          ) : null}
        </div>
      ) : null}

      <ResourceFormFields fields={create.fields} fieldErrors={fieldErrors} />

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Creando..." : "Crear"}
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
