"use client";

import { useEffect, useState } from "react";

import type { ResourceFormFieldCapability } from "@/core/api/contracts";
import { RequiredHint } from "@/components/resources/FieldRequirement";
import type { ResourceRow } from "@/core/resources/list-types";
import {
  relationItemId,
  relationItemLabel,
  relationItemSecondary,
  type RelationTarget,
} from "@/core/resources/relation-picker";
import {
  fetchRelationItem,
  fetchRelationMeta,
  searchRelationItems,
  type RelationSearchMeta,
} from "@/core/resources/relation-search-client";

type Selected = { id: string; label: string };

const inputClass =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none";

/**
 * Selector de relación para un campo FK del formulario genérico (F5). En lugar de pegar un
 * UUID a mano, el usuario BUSCA el registro padre por su etiqueta (nombre del paciente,
 * del médico, motivo de la consulta) y se guarda su UUID. El valor real viaja en un
 * ``<input>`` con ``name={field.name}``, así que el armado de payload (FormData) no cambia.
 * Mantiene un modo "ingresar ID manualmente" como respaldo para no perder capacidad.
 */
export function RelationPickerField({
  field,
  target,
  initialValue,
  errors,
}: Readonly<{
  field: ResourceFormFieldCapability;
  target: RelationTarget;
  initialValue?: string;
  errors: string[];
}>) {
  const [meta, setMeta] = useState<RelationSearchMeta | null>(null);
  const [manual, setManual] = useState(false);
  const [manualValue, setManualValue] = useState(initialValue ?? "");
  const [selected, setSelected] = useState<Selected | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResourceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const errorId = errors.length > 0 ? `${field.name}-error` : undefined;

  // Carga la metadata de búsqueda del recurso destino una vez. Si falla (sin permiso,
  // etc.) cae a modo manual para no bloquear el formulario.
  useEffect(() => {
    let active = true;
    fetchRelationMeta(target.resource)
      .then((value) => {
        if (active) {
          setMeta(value);
        }
      })
      .catch(() => {
        if (active) {
          setManual(true);
        }
      });
    return () => {
      active = false;
    };
  }, [target.resource]);

  // Precarga (edición): resuelve la etiqueta del valor inicial leyendo el item por id.
  useEffect(() => {
    if (!initialValue || !meta) {
      return;
    }
    let active = true;
    void fetchRelationItem(meta.apiPath, initialValue).then((item) => {
      if (!active) {
        return;
      }
      if (item) {
        setSelected({ id: initialValue, label: relationItemLabel(item, target) });
      } else {
        // No se pudo resolver: deja el UUID en modo manual para no perderlo.
        setManual(true);
      }
    });
    return () => {
      active = false;
    };
  }, [initialValue, meta, target]);

  // Búsqueda con debounce mientras se escribe (solo en modo selector).
  useEffect(() => {
    if (manual || !meta || selected) {
      return;
    }
    const term = query.trim();
    let active = true;
    // Todo el setState ocurre dentro del callback diferido (no en el cuerpo síncrono del
    // efecto), evitando renders en cascada. Por debajo del mínimo: limpia resultados.
    const handle = setTimeout(() => {
      if (term.length < Math.max(meta.searchMinLength, 1)) {
        setResults([]);
        setSearched(false);
        return;
      }
      setLoading(true);
      searchRelationItems(meta.apiPath, term)
        .then((items) => {
          if (active) {
            setResults(items);
            setSearched(true);
          }
        })
        .catch(() => {
          if (active) {
            setResults([]);
            setSearched(true);
          }
        })
        .finally(() => {
          if (active) {
            setLoading(false);
          }
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [query, manual, meta, selected]);

  function choose(item: ResourceRow) {
    const id = relationItemId(item);
    if (!id) {
      return;
    }
    setSelected({ id, label: relationItemLabel(item, target) });
    setQuery("");
    setResults([]);
    setSearched(false);
  }

  function switchToManual() {
    setManualValue(selected?.id ?? "");
    setSelected(null);
    setManual(true);
  }

  function switchToPicker() {
    setManual(false);
    setManualValue("");
  }

  return (
    <div>
      <label htmlFor={field.name} className="block text-sm font-medium text-slate-900">
        {field.label}
        <RequiredHint required={field.required} />
      </label>

      {manual ? (
        <>
          <input
            id={field.name}
            name={field.name}
            type="text"
            required={field.required}
            value={manualValue}
            onChange={(event) => setManualValue(event.target.value)}
            placeholder="Pega el identificador (UUID)"
            aria-required={field.required || undefined}
            aria-invalid={errors.length > 0 || undefined}
            aria-describedby={errorId}
            className={inputClass}
          />
          <button
            type="button"
            onClick={switchToPicker}
            className="mt-1 text-sm font-medium text-slate-600 underline hover:text-slate-900"
          >
            Buscar por nombre
          </button>
        </>
      ) : (
        <>
          {/* El valor real (UUID) viaja aquí; el resto de la UI solo lo alimenta. */}
          <input type="hidden" name={field.name} value={selected?.id ?? ""} />

          {selected ? (
            <div className="mt-1 flex items-center justify-between gap-3 rounded-md border border-slate-300 px-3 py-2">
              <span className="text-sm text-slate-900">{selected.label}</span>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-sm font-medium text-slate-600 underline hover:text-slate-900"
              >
                Cambiar
              </button>
            </div>
          ) : (
            <>
              <input
                id={field.name}
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por nombre..."
                aria-describedby={errorId}
                className={inputClass}
              />
              {loading ? (
                <p className="mt-1 text-sm text-slate-500">Buscando...</p>
              ) : results.length > 0 ? (
                <ul className="mt-1 max-h-56 overflow-auto rounded-md border border-slate-200">
                  {results.map((item) => {
                    const id = relationItemId(item);
                    if (!id) {
                      return null;
                    }
                    const secondary = relationItemSecondary(item, target);
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          onClick={() => choose(item)}
                          className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-slate-50"
                        >
                          <span className="font-medium text-slate-900">
                            {relationItemLabel(item, target)}
                          </span>
                          {secondary ? (
                            <span className="text-xs text-slate-500">{secondary}</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : searched ? (
                <p className="mt-1 text-sm text-slate-500">Sin resultados.</p>
              ) : null}
              <button
                type="button"
                onClick={switchToManual}
                className="mt-1 text-sm font-medium text-slate-600 underline hover:text-slate-900"
              >
                Ingresar ID manualmente
              </button>
            </>
          )}
        </>
      )}

      {field.description ? (
        <p className="mt-1 text-sm text-slate-500">{field.description}</p>
      ) : null}
      {errors.length > 0 ? (
        <p id={errorId} className="mt-1 text-sm text-red-600">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}
