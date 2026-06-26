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

  function selectedCountIn(group: RelationOptionGroup): number {
    return group.options.reduce((total, option) => total + (selected.has(option.value) ? 1 : 0), 0);
  }

  function allSelectedIn(group: RelationOptionGroup): boolean {
    return group.options.length > 0 && group.options.every((option) => selected.has(option.value));
  }

  // Selección/limpieza en bloque de un grupo: agiliza el catálogo agrupado de permisos
  // (muchas casillas por grupo) sin tocar la selección de los demás grupos.
  function toggleGroup(group: RelationOptionGroup): void {
    const selectAll = !allSelectedIn(group);
    setSelected((current) => {
      const next = new Set(current);
      for (const option of group.options) {
        if (selectAll) {
          next.add(option.value);
        } else {
          next.delete(option.value);
        }
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
              <legend className="mb-1 flex w-full items-center gap-3 text-sm font-semibold text-slate-700">
                <span>{group.label ?? title}</span>
                <span className="text-xs font-normal text-slate-500">
                  {selectedCountIn(group)}/{group.options.length}
                </span>
                {group.options.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group)}
                    disabled={pending}
                    aria-label={`${
                      allSelectedIn(group) ? "Quitar" : "Seleccionar"
                    } todo en ${group.label ?? title}`}
                    className="text-xs font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {allSelectedIn(group) ? "Quitar todo" : "Seleccionar todo"}
                  </button>
                ) : null}
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
