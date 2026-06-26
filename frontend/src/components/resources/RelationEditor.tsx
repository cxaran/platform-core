"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { ApiRequestError } from "@/core/api/api-error";
import type { HttpMethod } from "@/core/api/contracts";
import type { RelationOptionGroup } from "@/core/resources/relation-editor-client";
import { replaceRelation } from "@/core/resources/resource-mutation-client";

const ADMIN_COVERAGE_MESSAGE =
  "No se puede aplicar el cambio porque dejaría la plataforma sin cobertura administrativa.";

function submitError(error: ApiRequestError): string {
  if (error.status === 409 && error.body.code === "admin_coverage_required") {
    return ADMIN_COVERAGE_MESSAGE;
  }
  if (error.status === 422) {
    return "La selección contiene valores no permitidos.";
  }
  if (error.status === 409) {
    return "No se pudo aplicar el cambio por un conflicto. Inténtalo nuevamente.";
  }
  return "No se pudo aplicar el cambio. Inténtalo nuevamente.";
}

export function RelationEditor({
  title,
  description,
  groups,
  initialSelected,
  mutationUrl,
  mutationMethod,
  requestField,
  listPath,
}: Readonly<{
  title: string;
  description?: string | null;
  groups: RelationOptionGroup[];
  initialSelected: string[];
  mutationUrl: string;
  mutationMethod: HttpMethod;
  requestField: string;
  listPath: string;
}>) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelected));
  const [pending, setPending] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);

  function toggle(value: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setGeneralError(null);

    try {
      await replaceRelation(mutationUrl, mutationMethod, requestField, [...selected]);
      router.replace(listPath);
      router.refresh();
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
        setGeneralError(submitError(error));
      } else {
        setGeneralError("No se pudo aplicar el cambio. Inténtalo nuevamente.");
      }
      setPending(false);
    }
  }

  const isEmpty = groups.every((group) => group.options.length === 0);

  return (
    <form
      onSubmit={onSubmit}
      aria-label={title}
      className="max-w-2xl space-y-6 rounded-lg border border-slate-200 bg-white p-6"
    >
      <header>
        <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </header>

      {generalError ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {generalError}
        </div>
      ) : null}

      {isEmpty ? (
        <p className="text-sm text-slate-500">No hay opciones disponibles.</p>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <fieldset key={group.name} className="space-y-2">
              <legend className="text-sm font-semibold text-slate-700">
                {group.label ?? title}
              </legend>
              <div className="space-y-1.5">
                {group.options.map((option) => (
                  <label
                    key={option.value}
                    className="flex items-center gap-2 text-sm text-slate-800"
                  >
                    <input
                      type="checkbox"
                      name={requestField}
                      value={option.value}
                      checked={selected.has(option.value)}
                      onChange={() => toggle(option.value)}
                      disabled={pending}
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-500"
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      )}

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
