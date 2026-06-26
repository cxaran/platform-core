import type { ResourceFormFieldCapability } from "@/core/api/contracts";

type FieldErrors = Record<string, string[]>;

function fieldInputType(widget: ResourceFormFieldCapability["widget"]): string {
  if (widget === "email") return "email";
  if (widget === "password") return "password";
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
  function initialText(name: string): string {
    const value = initialValues[name];
    return value == null ? "" : String(value);
  }

  return (
    <div className="space-y-4">
      {fields.map((field) => {
        const errors = fieldErrors[field.name] ?? [];
        const errorId = errors.length > 0 ? `${field.name}-error` : undefined;

        if (field.widget === "switch") {
          return (
            <div key={field.name} className="rounded-md border border-slate-200 bg-white p-4">
              <label className="flex items-center gap-3 text-sm font-medium text-slate-900">
                <input
                  type="checkbox"
                  name={field.name}
                  defaultChecked={Boolean(initialValues[field.name])}
                  className="h-4 w-4 rounded border-slate-300 text-slate-950"
                  aria-describedby={errorId}
                />
                {field.label}
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

        return (
          <div key={field.name}>
            <label htmlFor={field.name} className="block text-sm font-medium text-slate-900">
              {field.label}
            </label>
            {field.widget === "textarea" ? (
              <textarea
                id={field.name}
                name={field.name}
                required={field.required}
                defaultValue={initialText(field.name)}
                aria-describedby={errorId}
                className="mt-1 min-h-28 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none"
              />
            ) : (
              <input
                id={field.name}
                name={field.name}
                type={fieldInputType(field.widget)}
                required={field.required}
                defaultValue={initialText(field.name)}
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
