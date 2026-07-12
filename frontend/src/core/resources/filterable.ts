import type {
  FilterableFieldCapability,
  FilterableOperatorCapability,
  ResourceListCapability,
} from "@/core/api/contracts";

/**
 * Controles de filtro declarativos derivados de ``list.filterable_fields``.
 *
 * El frontend nunca infiere nombres de parámetro, sufijos ni operadores: consume los
 * publicados por backend. Cada operador trae su(s) ``parameter_name`` real(es), que
 * son a la vez los nombres de los inputs del formulario y los query params del API.
 *
 * Valida el CONTRATO (no el input del usuario): una capability inconsistente lanza
 * ``FilterableContractError`` → error boundary. El input del usuario se valida en
 * ``parseFilterableValues`` y se ignora silenciosamente si no cumple.
 */

const RESERVED_PARAMETERS = new Set(["q", "sort", "limit", "offset"]);

// Tope de longitud de los filtros de texto. Coincide con el ``max_filter_text_length``
// por defecto del backend: enviar más produciría un 422, así que se descarta antes.
const MAX_TEXT_FILTER_LENGTH = 200;

export class FilterableContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilterableContractError";
  }
}

type SelectValidator = { kind: "select"; values: ReadonlySet<string> };
type DateValidator = { kind: "date" };
type TextValidator = { kind: "text"; maxLength: number };
type MultiValidator = {
  kind: "multi";
  // Universo cerrado (enum/select declarado); undefined = universo abierto (facetas).
  values?: ReadonlySet<string>;
  maxValues: number;
  maxLength: number;
};
type ParamValidator = SelectValidator | DateValidator | TextValidator | MultiValidator;

/**
 * Separador de los valores de un filtro múltiple (``in``) DENTRO de un solo query
 * param de la página: U+001F (unit separator), imposible de teclear y siempre
 * percent-encoded. El estado canónico sigue siendo ``Record<string, string>`` — el
 * valor unido se divide en parámetros REPETIDOS solo en la frontera con el API
 * (``expandMultiValueParams``), que es lo que FastAPI parsea como lista.
 */
export const MULTI_VALUE_SEPARATOR = "\u001f";

export function joinMultiValue(values: readonly string[]): string {
  return values.join(MULTI_VALUE_SEPARATOR);
}

export function splitMultiValue(value: string): string[] {
  return value.split(MULTI_VALUE_SEPARATOR).filter((part) => part !== "");
}

// Tope defensivo si el contrato no declara max_values (coincide con el default
// ``max_in_values`` del backend).
const DEFAULT_MAX_IN_VALUES = 100;

export type FilterableOperatorControl = {
  key: string;
  label: string;
  widget: FilterableOperatorCapability["widget"];
  valueShape: FilterableOperatorCapability["value_shape"];
  parameterName?: string;
  fromParameter?: string;
  toParameter?: string;
  options?: readonly { value: string; label: string }[];
  caseSensitive?: boolean;
  calendarTimezone?: string;
  rangeEndInclusive?: boolean;
  placeholder?: string;
  maxValues?: number;
};

export type FilterableFieldControl = {
  key: string;
  label: string;
  valueType: FilterableFieldCapability["value_type"];
  operators: readonly FilterableOperatorControl[];
  // El campo admite autofiltro por valores únicos (checklist con conteos vía el
  // ``facets_url`` de la lista).
  facetable: boolean;
};

export type FilterableControls = {
  ordered: readonly FilterableFieldControl[];
  // Nombres de parámetro reales en orden determinista (allowlist de serialización).
  paramNames: readonly string[];
  validators: ReadonlyMap<string, ParamValidator>;
};

function registerParameter(
  parameter: string,
  validator: ParamValidator,
  fieldKey: string,
  paramNames: string[],
  validators: Map<string, ParamValidator>,
): void {
  if (!parameter) {
    throw new FilterableContractError(`El campo '${fieldKey}' tiene un parámetro vacío.`);
  }
  if (RESERVED_PARAMETERS.has(parameter)) {
    throw new FilterableContractError(`El parámetro '${parameter}' es reservado.`);
  }
  if (validators.has(parameter)) {
    throw new FilterableContractError(`Parámetro de filtro duplicado: ${parameter}.`);
  }
  validators.set(parameter, validator);
  paramNames.push(parameter);
}

function selectValidator(
  operator: FilterableOperatorCapability,
  fieldKey: string,
): SelectValidator {
  if (!operator.options || operator.options.length === 0) {
    throw new FilterableContractError(
      `El operador '${operator.key}' de '${fieldKey}' (select) no declara opciones.`,
    );
  }
  const values = new Set<string>();
  for (const option of operator.options) {
    if (!option.value) {
      throw new FilterableContractError(`El campo '${fieldKey}' tiene una opción con value vacío.`);
    }
    if (!option.label || option.label.trim() === "") {
      throw new FilterableContractError(`El campo '${fieldKey}' tiene una opción sin label.`);
    }
    if (values.has(option.value)) {
      throw new FilterableContractError(
        `El campo '${fieldKey}' tiene el value de opción duplicado: ${option.value}.`,
      );
    }
    values.add(option.value);
  }
  return { kind: "select", values };
}

function buildOperatorControl(
  operator: FilterableOperatorCapability,
  fieldKey: string,
  paramNames: string[],
  validators: Map<string, ParamValidator>,
): FilterableOperatorControl {
  const base: FilterableOperatorControl = {
    key: operator.key,
    label: operator.label,
    widget: operator.widget,
    valueShape: operator.value_shape,
    caseSensitive: operator.case_sensitive ?? undefined,
    calendarTimezone: operator.calendar_timezone ?? undefined,
    rangeEndInclusive: operator.range_end_inclusive ?? undefined,
    placeholder: operator.placeholder ?? undefined,
  };

  if (operator.widget === "daterange") {
    const params = operator.parameters;
    if (!params) {
      throw new FilterableContractError(
        `El operador '${operator.key}' de '${fieldKey}' (daterange) no declara parameters.`,
      );
    }
    registerParameter(params.from, { kind: "date" }, fieldKey, paramNames, validators);
    registerParameter(params.to, { kind: "date" }, fieldKey, paramNames, validators);
    return { ...base, fromParameter: params.from, toParameter: params.to };
  }

  const parameter = operator.parameter_name;
  if (!parameter) {
    throw new FilterableContractError(
      `El operador '${operator.key}' de '${fieldKey}' no declara parameter_name.`,
    );
  }

  let validator: ParamValidator;
  if (operator.value_shape === "multi") {
    // Autofiltro por valores (``in``): N valores unidos con MULTI_VALUE_SEPARATOR
    // en el estado canónico. Con opciones declaradas (enum/select) cada valor debe
    // pertenecer al universo; sin ellas, el universo es abierto (facetas).
    validator = {
      kind: "multi",
      values:
        operator.options && operator.options.length > 0
          ? new Set(operator.options.map((option) => option.value))
          : undefined,
      maxValues: operator.max_values ?? DEFAULT_MAX_IN_VALUES,
      maxLength: MAX_TEXT_FILTER_LENGTH,
    };
  } else if (operator.widget === "select") {
    validator = selectValidator(operator, fieldKey);
  } else if (operator.widget === "date") {
    validator = { kind: "date" };
  } else {
    validator = { kind: "text", maxLength: MAX_TEXT_FILTER_LENGTH };
  }
  registerParameter(parameter, validator, fieldKey, paramNames, validators);

  return {
    ...base,
    parameterName: parameter,
    options: operator.options?.map((option) => ({ value: option.value, label: option.label })),
    maxValues: operator.max_values ?? undefined,
  };
}

export function buildFilterableControls(list: ResourceListCapability): FilterableControls {
  const ordered: FilterableFieldControl[] = [];
  const paramNames: string[] = [];
  const validators = new Map<string, ParamValidator>();
  const seenFields = new Set<string>();

  for (const field of list.filterable_fields ?? []) {
    if (!field.key) {
      throw new FilterableContractError("Campo filtrable con key vacío.");
    }
    if (seenFields.has(field.key)) {
      throw new FilterableContractError(`Campo filtrable duplicado: ${field.key}.`);
    }
    seenFields.add(field.key);
    if (!field.operators || field.operators.length === 0) {
      throw new FilterableContractError(`El campo filtrable '${field.key}' no declara operadores.`);
    }

    const operators = field.operators.map((operator) =>
      buildOperatorControl(operator, field.key, paramNames, validators),
    );
    ordered.push({
      key: field.key,
      label: field.label,
      valueType: field.value_type,
      operators,
      facetable: field.facetable ?? false,
    });
  }

  return { ordered, paramNames, validators };
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isAcceptedValue(validator: ParamValidator, value: string): boolean {
  switch (validator.kind) {
    case "select":
      return validator.values.has(value);
    case "date":
      return isValidIsoDate(value);
    case "text":
      return value.length > 0 && value.length <= validator.maxLength;
    case "multi": {
      const parts = splitMultiValue(value);
      if (parts.length === 0 || parts.length > validator.maxValues) {
        return false;
      }
      return parts.every(
        (part) =>
          part.length <= validator.maxLength &&
          (validator.values === undefined || validator.values.has(part)),
      );
    }
  }
}

function singleParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Valores de filtro activos, validados contra el contrato. Solo se aceptan parámetros
 * declarados (allowlist), no repetidos y con un value que cumple su validador; lo
 * demás se ignora silenciosamente (jamás se reenvía input crudo del usuario).
 */
export function parseFilterableValues(
  searchParams: Record<string, string | string[] | undefined>,
  controls: FilterableControls,
): Record<string, string> {
  const filters: Record<string, string> = {};
  for (const parameter of controls.paramNames) {
    const validator = controls.validators.get(parameter);
    const rawValue = searchParams[parameter];
    // Los filtros múltiples aceptan además la forma repetida (?x_in=a&x_in=b),
    // normalizándola a la forma canónica unida. El resto sigue siendo un solo valor.
    const raw =
      validator?.kind === "multi" && Array.isArray(rawValue)
        ? joinMultiValue(rawValue.map((part) => part.trim()).filter((part) => part !== ""))
        : singleParam(rawValue);
    if (raw === undefined) {
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed === "") {
      continue;
    }
    if (validator && isAcceptedValue(validator, trimmed)) {
      filters[parameter] = trimmed;
    }
  }
  return filters;
}

/** Emite los parámetros activos (allowlist ordenada), revalidando cada value. */
export function appendFilterableParams(
  params: URLSearchParams,
  filters: Record<string, string>,
  controls: FilterableControls,
): void {
  for (const parameter of controls.paramNames) {
    const value = filters[parameter];
    if (value === undefined) {
      continue;
    }
    const validator = controls.validators.get(parameter);
    if (validator && isAcceptedValue(validator, value)) {
      params.set(parameter, value);
    }
  }
}

/**
 * Frontera con el API: divide cada valor unido con ``MULTI_VALUE_SEPARATOR`` en
 * parámetros REPETIDOS (lo que FastAPI parsea como lista). Las URLs de página
 * conservan la forma unida (un solo param); solo las requests al backend pasan
 * por aquí. Devuelve una instancia nueva; no muta la entrada.
 */
export function expandMultiValueParams(params: URLSearchParams): URLSearchParams {
  const expanded = new URLSearchParams();
  for (const [key, value] of params) {
    if (value.includes(MULTI_VALUE_SEPARATOR)) {
      for (const part of splitMultiValue(value)) {
        expanded.append(key, part);
      }
    } else {
      expanded.append(key, value);
    }
  }
  return expanded;
}
