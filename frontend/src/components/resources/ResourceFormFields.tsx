import type { ResourceFormFieldCapability } from "@/core/api/contracts";
import { RelationPickerField } from "@/components/resources/RelationPickerField";
import { RequiredHint } from "@/components/resources/FieldRequirement";
import { resolveRelationTarget } from "@/core/resources/relation-picker";

type FieldErrors = Record<string, string[]>;

function fieldInputType(widget: ResourceFormFieldCapability["widget"]): string {
  if (widget === "email") return "email";
  if (widget === "password") return "password";
  if (widget === "number") return "number";
  if (widget === "datetime") return "datetime-local";
  if (widget === "date") return "date";
  if (widget === "time") return "time";
  return "text";
}

export function ResourceFormFields({
  fields,
  fieldErrors,
  initialValues = {},
}: Readonly<{
  fields: readonly ResourceFormFieldCapability[];
  fieldErrors: FieldErrors;
  initialValues?: Record<string, unknown>;
}>) {
  function initialText(field: ResourceFormFieldCapability): string {
    const value = initialValues[field.name];
    if (value == null) {
      return "";
    }
    const text = String(value);
    // Los inputs nativos exigen un formato exacto; recortamos el ISO del backend para que
    // se precarguen en edición (date: YYYY-MM-DD, datetime-local: YYYY-MM-DDTHH:MM, time: HH:MM).
    if (field.widget === "date") {
      return text.slice(0, 10);
    }
    if (field.widget === "datetime") {
      return text.slice(0, 16);
    }
    if (field.widget === "time") {
      return text.slice(0, 5);
    }
    return text;
  }

  return (
    <div className="space-y-4">
      {fields.map((field) => {
        const errors = fieldErrors[field.name] ?? [];
        const errorId = errors.length > 0 ? `${field.name}-error` : undefined;

        // Campos FK (widget ``text`` cuyo nombre resuelve a un recurso destino): se
        // reemplaza el input de UUID a mano por el selector de relación (buscar+elegir).
        const relationTarget =
          field.widget === "text" ? resolveRelationTarget(field.name) : null;
        if (relationTarget) {
          const initial = initialValues[field.name];
          return (
            <RelationPickerField
              key={field.name}
              field={field}
              target={relationTarget}
              initialValue={initial == null ? undefined : String(initial)}
              errors={errors}
            />
          );
        }

        if (field.widget === "switch") {
          return (
            <div key={field.name} className="rounded-md border border-slate-200 bg-white p-4">
              <label className="flex items-center gap-3 text-sm font-medium text-slate-900">
                <input
                  type="checkbox"
                  name={field.name}
                  defaultChecked={Boolean(initialValues[field.name])}
                  className="h-4 w-4 rounded border-slate-300 text-slate-950"
                  aria-required={field.required || undefined}
                  aria-invalid={errors.length > 0 || undefined}
                  aria-describedby={errorId}
                />
                {field.label}
                <RequiredHint required={field.required} />
              </label>
              {field.description ? (
                <p className="mt-1 text-sm text-slate-500">{field.description}</p>
              ) : null}
              {errors.length > 0 ? (
                <p id={errorId} className="mt-2 text-sm text-red-600">
                  {errors.join(" ")}
                </p>
              ) : null}
            </div>
          );
        }

        if (field.widget === "select") {
          const options = field.options ?? [];
          const initial = initialValues[field.name];
          const initialValue = initial == null ? "" : String(initial);
          return (
            <div key={field.name}>
              <label htmlFor={field.name} className="block text-sm font-medium text-slate-900">
                {field.label}
              </label>
              <select
                id={field.name}
                name={field.name}
                required={field.required}
                defaultValue={initialValue}
                aria-required={field.required || undefined}
                aria-invalid={errors.length > 0 || undefined}
                aria-describedby={errorId}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
              >
                {/* Opción vacía solo cuando el campo es opcional (permite no elegir). */}
                {field.required ? null : <option value="">—</option>}
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
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

        return (
          <div key={field.name}>
            <label htmlFor={field.name} className="block text-sm font-medium text-slate-900">
              {field.label}
              <RequiredHint required={field.required} />
            </label>
            {field.widget === "textarea" ? (
              <textarea
                id={field.name}
                name={field.name}
                required={field.required}
                defaultValue={initialText(field)}
                aria-required={field.required || undefined}
                aria-invalid={errors.length > 0 || undefined}
                aria-describedby={errorId}
                className="mt-1 min-h-28 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
              />
            ) : (
              <input
                id={field.name}
                name={field.name}
                type={fieldInputType(field.widget)}
                required={field.required}
                defaultValue={initialText(field)}
                // ``step="any"`` permite decimales (p. ej. peso/temperatura) en campos numéricos.
                step={field.widget === "number" ? "any" : undefined}
                aria-required={field.required || undefined}
                aria-invalid={errors.length > 0 || undefined}
                aria-describedby={errorId}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
              />
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
      })}
    </div>
  );
}
