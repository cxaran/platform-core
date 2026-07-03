import { resolveRelationTarget } from "@/core/resources/relation-picker";
import {
  fieldDisplayKind,
  formatDisplayValue,
  type DisplayField,
} from "@/core/resources/resource-detail-view";

import { RelationLabel } from "./RelationLabel";

/**
 * Render de SOLO LECTURA de los campos de un recurso, guiado por la misma metadata de capability
 * que el formulario de edición. No hay un solo ``<input>``/``<select>``/``<textarea>``: cada campo
 * se pinta como texto (o, en una FK, como etiqueta humana resuelta async). El detalle nunca muta.
 */
export function ResourceDetailFields({
  fields,
  values,
}: Readonly<{
  fields: readonly DisplayField[];
  values: Record<string, unknown>;
}>) {
  if (fields.length === 0) {
    return <p className="text-sm text-slate-500">Este recurso no declara campos para mostrar.</p>;
  }

  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
      {fields.map((field) => {
        const value = values[field.name];
        const kind = fieldDisplayKind(field);
        const relationTarget = kind === "relation" ? resolveRelationTarget(field.name) : null;
        return (
          <div key={field.name} className="min-w-0">
            <dt className="text-sm font-medium text-slate-500">{field.label}</dt>
            <dd className="mt-1 break-words text-sm text-slate-900">
              {relationTarget ? (
                <RelationLabel
                  target={relationTarget}
                  value={value == null ? null : String(value)}
                />
              ) : (
                formatDisplayValue(field, value)
              )}
            </dd>
            {field.description ? (
              <p className="mt-1 text-xs text-slate-400">{field.description}</p>
            ) : null}
          </div>
        );
      })}
    </dl>
  );
}
