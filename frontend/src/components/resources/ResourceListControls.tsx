import type { ResourceListCapability } from "@/core/api/contracts";
import type {
  FilterableControls,
  FilterableFieldControl,
  FilterableOperatorControl,
} from "@/core/resources/filterable";

type SearchCapability = ResourceListCapability["search"];

const INPUT_CLASS = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const LABEL_CLASS = "mb-1 text-xs font-medium text-slate-600";

function fieldValue(filters: Record<string, string>, parameter?: string): string {
  return parameter ? (filters[parameter] ?? "") : "";
}

function SelectControl({
  id,
  label,
  parameter,
  options,
  value,
}: Readonly<{
  id: string;
  label: string;
  parameter: string;
  options: readonly { value: string; label: string }[];
  value: string;
}>) {
  return (
    <div className="flex flex-col">
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      <select id={id} name={parameter} defaultValue={value} className={INPUT_CLASS}>
        <option value="">Todos</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function InputControl({
  id,
  label,
  parameter,
  type,
  value,
  placeholder,
}: Readonly<{
  id: string;
  label: string;
  parameter: string;
  type: "text" | "date";
  value: string;
  placeholder?: string;
}>) {
  return (
    <div className="flex flex-col">
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>
      <input
        id={id}
        name={parameter}
        type={type}
        defaultValue={value}
        placeholder={placeholder}
        maxLength={type === "text" ? 200 : undefined}
        className={INPUT_CLASS}
      />
    </div>
  );
}

function OperatorControl({
  field,
  operator,
  filters,
}: Readonly<{
  field: FilterableFieldControl;
  operator: FilterableOperatorControl;
  filters: Record<string, string>;
}>) {
  const label = `${field.label} · ${operator.label}`;
  const baseId = `filter-${field.key}-${operator.key}`;

  if (operator.widget === "daterange") {
    return (
      <>
        <InputControl
          id={`${baseId}-from`}
          label={`${label} (desde)`}
          parameter={operator.fromParameter ?? ""}
          type="date"
          value={fieldValue(filters, operator.fromParameter)}
        />
        <InputControl
          id={`${baseId}-to`}
          label={`${label} (hasta)`}
          parameter={operator.toParameter ?? ""}
          type="date"
          value={fieldValue(filters, operator.toParameter)}
        />
      </>
    );
  }

  const parameter = operator.parameterName ?? "";
  if (operator.widget === "select") {
    return (
      <SelectControl
        id={baseId}
        label={label}
        parameter={parameter}
        options={operator.options ?? []}
        value={fieldValue(filters, operator.parameterName)}
      />
    );
  }

  return (
    <InputControl
      id={baseId}
      label={label}
      parameter={parameter}
      type={operator.widget === "date" ? "date" : "text"}
      value={fieldValue(filters, operator.parameterName)}
      placeholder={operator.placeholder}
    />
  );
}

function FieldControl({
  field,
  filters,
}: Readonly<{ field: FilterableFieldControl; filters: Record<string, string> }>) {
  // Campo de un solo operador select (p. ej. is_active): un control compacto con el
  // label del campo, sin envoltorio de fieldset.
  const [first] = field.operators;
  if (field.operators.length === 1 && first.widget === "select") {
    return (
      <SelectControl
        id={`filter-${field.key}-${first.key}`}
        label={field.label}
        parameter={first.parameterName ?? ""}
        options={first.options ?? []}
        value={fieldValue(filters, first.parameterName)}
      />
    );
  }

  return (
    <fieldset className="flex flex-wrap items-end gap-3 rounded-md border border-slate-200 p-3">
      <legend className="px-1 text-xs font-semibold text-slate-700">{field.label}</legend>
      {field.operators.map((operator) => (
        <OperatorControl
          key={`${field.key}-${operator.key}`}
          field={field}
          operator={operator}
          filters={filters}
        />
      ))}
    </fieldset>
  );
}

export function ResourceListControls({
  resourceName,
  search,
  controls,
  filters,
  searchValue,
  searchTooShort,
  sortParam,
  limit,
}: Readonly<{
  resourceName: string;
  search: SearchCapability;
  controls: FilterableControls;
  filters: Record<string, string>;
  searchValue: string;
  searchTooShort: boolean;
  sortParam?: string;
  limit: number;
}>) {
  const hasSearch = search.enabled;
  const hasFilters = controls.ordered.length > 0;
  if (!hasSearch && !hasFilters) {
    return null;
  }

  const action = `/resources/${encodeURIComponent(resourceName)}`;
  const effectiveMin = Math.max(search.min_length ?? 0, 1);

  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-4">
      {hasSearch ? (
        <div className="flex flex-col">
          <label htmlFor="q" className={LABEL_CLASS}>
            Buscar
          </label>
          <input
            id="q"
            type="search"
            name="q"
            defaultValue={searchValue}
            minLength={search.min_length ?? undefined}
            maxLength={search.max_length ?? undefined}
            placeholder="Buscar…"
            className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          {searchTooShort ? (
            <p className="mt-1 text-xs text-slate-500">
              Escribe al menos {effectiveMin} caracteres para buscar.
            </p>
          ) : null}
        </div>
      ) : null}

      {controls.ordered.map((field) => (
        <FieldControl key={field.key} field={field} filters={filters} />
      ))}

      {/* Preserva sort explícito y límite; sin offset → reinicia en 0. */}
      {sortParam ? <input type="hidden" name="sort" value={sortParam} /> : null}
      <input type="hidden" name="limit" value={limit} />

      <button
        type="submit"
        className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
      >
        Aplicar
      </button>
    </form>
  );
}
