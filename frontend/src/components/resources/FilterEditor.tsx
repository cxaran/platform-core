"use client";

import { useState } from "react";

import type { FilterableFieldControl } from "@/core/resources/filterable";

import { fieldParameterNames } from "./filter-nav";

/**
 * Editor de los operadores de UN campo filtrable (contenido de los menús de
 * filtro). Los inputs salen del contrato (widget/opciones/placeholder); al
 * aplicar se entregan updates por nombre de parámetro real — vacío = quitar.
 * No valida el input del usuario: eso lo hace parseFilterableValues al aterrizar
 * la URL (lo inválido se ignora en silencio, igual que siempre).
 */

const INPUT_CLASS =
  "w-full rounded-[9px] border border-[var(--border2)] bg-[var(--bg2)] px-2.5 py-1.5 text-[13px] text-[var(--tx)] outline-none transition focus:border-[var(--accent-bd)]";
const LABEL_CLASS = "mb-1 block text-[11.5px] font-medium text-[var(--tx3)]";

export function FilterEditor({
  field,
  values,
  onApply,
}: Readonly<{
  field: FilterableFieldControl;
  // Valores activos actuales, keyed por nombre de parámetro real.
  values: Readonly<Record<string, string>>;
  onApply: (updates: Record<string, string | null>) => void;
}>) {
  const parameters = fieldParameterNames(field);
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const name of parameters) initial[name] = values[name] ?? "";
    return initial;
  });

  const setValue = (parameter: string, value: string) =>
    setDraft((previous) => ({ ...previous, [parameter]: value }));

  const apply = () => {
    const updates: Record<string, string | null> = {};
    for (const name of parameters) {
      const value = draft[name]?.trim() ?? "";
      updates[name] = value === "" ? null : value;
    }
    onApply(updates);
  };

  const clear = () => {
    const updates: Record<string, string | null> = {};
    for (const name of parameters) updates[name] = null;
    onApply(updates);
  };

  const hasActive = parameters.some((name) => (values[name] ?? "") !== "");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
      className="space-y-2.5"
    >
      {field.operators.map((operator) => {
        const baseId = `flt-${field.key}-${operator.key}`;
        if (operator.widget === "daterange") {
          return (
            <div key={operator.key} className="space-y-2">
              <div>
                <label htmlFor={`${baseId}-from`} className={LABEL_CLASS}>
                  {operator.label} (desde)
                </label>
                <input
                  id={`${baseId}-from`}
                  type="date"
                  value={draft[operator.fromParameter ?? ""] ?? ""}
                  onChange={(event) => setValue(operator.fromParameter ?? "", event.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label htmlFor={`${baseId}-to`} className={LABEL_CLASS}>
                  {operator.label} (hasta)
                </label>
                <input
                  id={`${baseId}-to`}
                  type="date"
                  value={draft[operator.toParameter ?? ""] ?? ""}
                  onChange={(event) => setValue(operator.toParameter ?? "", event.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
            </div>
          );
        }

        const parameter = operator.parameterName ?? "";
        if (operator.widget === "select") {
          return (
            <div key={operator.key}>
              <label htmlFor={baseId} className={LABEL_CLASS}>
                {operator.label}
              </label>
              <select
                id={baseId}
                value={draft[parameter] ?? ""}
                onChange={(event) => setValue(parameter, event.target.value)}
                className={INPUT_CLASS}
              >
                <option value="">Todos</option>
                {(operator.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        return (
          <div key={operator.key}>
            <label htmlFor={baseId} className={LABEL_CLASS}>
              {operator.label}
            </label>
            <input
              id={baseId}
              type={operator.widget === "date" ? "date" : "text"}
              maxLength={operator.widget === "date" ? undefined : 200}
              placeholder={operator.placeholder}
              value={draft[parameter] ?? ""}
              onChange={(event) => setValue(parameter, event.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        );
      })}

      <div className="flex items-center justify-end gap-2 pt-1">
        {hasActive ? (
          <button
            type="button"
            onClick={clear}
            className="rounded-[9px] px-2.5 py-1.5 text-[12.5px] font-medium text-[var(--tx2)] transition hover:bg-[var(--panel2)] hover:text-[var(--danger)]"
          >
            Limpiar
          </button>
        ) : null}
        <button
          type="submit"
          className="rounded-[9px] bg-[var(--accent)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--on-accent)] shadow-[var(--soft)] transition hover:brightness-105"
        >
          Aplicar
        </button>
      </div>
    </form>
  );
}
