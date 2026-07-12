// Validador mínimo de un subconjunto de JSON Schema, suficiente para validar los
// argumentos de las tools del agente sin añadir una dependencia pesada. Soporta objetos
// con propiedades tipadas (string/integer/number/boolean/object), required, enum, minimum/
// maximum, format:"uuid" y additionalProperties:false.
//
// Para propiedades de tipo "object" la validación es SUPERFICIAL: se comprueba que el valor
// sea un objeto, pero no se recursan sus claves (p. ej. los insumos de una escala del negocio,
// cuya validación estricta vive en el backend, que responde 422 nombrando el campo faltante).

export interface PropSchema {
  type: "string" | "integer" | "number" | "boolean" | "object";
  description?: string;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  format?: "uuid";
  // Restricción de forma para cadenas (p. ej. CURP, teléfono, fecha ISO). Si el valor no
  // casa, el error NOMBRA el campo para que el agente pida corregirlo (nunca asume un valor).
  pattern?: string;
  additionalProperties?: boolean;
}

export interface ObjectSchema {
  type: "object";
  properties: Record<string, PropSchema>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

// UUID "nil" (todo ceros): un placeholder ALUCINADO que algunos modelos envían para un campo
// UUID opcional que en realidad no aplica (p. ej. related_diagnosis_id sin diagnóstico). No es
// un id real, así que el backend lo rechaza (422). Se trata como AUSENTE, nunca como valor.
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function isPlaceholderUuid(value: unknown): boolean {
  return typeof value === "string" && (value.trim() === "" || value.toLowerCase() === NIL_UUID);
}

/**
 * Sanea los argumentos ANTES de validar/ejecutar: elimina los valores PLACEHOLDER (UUID nil
 * "00000000-…" o cadena vacía) en campos ``format:"uuid"`` OPCIONALES (no requeridos). El modelo
 * a veces rellena un UUID opcional ausente con el nil-UUID; enviarlo hace que el backend rechace
 * la acción (422 "no pertenece a la consulta") en lugar de omitir el campo. Tratarlo como ausente
 * es lo correcto: el campo es opcional. NO toca los requeridos (ahí un placeholder debe fallar la
 * validación para que el modelo lo corrija) ni ningún campo que no sea UUID. Devuelve una COPIA;
 * no muta la entrada. Es idempotente y no-op cuando no hay placeholders.
 */
export function normalizeToolArgs(schema: ObjectSchema, value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const required = new Set(schema.required ?? []);
  const obj = value as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(obj)) {
    const prop = schema.properties[key];
    if (prop?.type === "string" && prop.format === "uuid" && !required.has(key) && isPlaceholderUuid(raw)) {
      continue; // se omite el placeholder: el campo opcional queda ausente.
    }
    cleaned[key] = raw;
  }
  return cleaned;
}

function checkProp(key: string, prop: PropSchema, value: unknown): string | null {
  if (prop.type === "integer" || prop.type === "number") {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return `El campo '${key}' debe ser numérico.`;
    }
    if (prop.type === "integer" && !Number.isInteger(value)) {
      return `El campo '${key}' debe ser un entero.`;
    }
    if (typeof prop.minimum === "number" && value < prop.minimum) {
      return `El campo '${key}' debe ser >= ${prop.minimum}.`;
    }
    if (typeof prop.maximum === "number" && value > prop.maximum) {
      return `El campo '${key}' debe ser <= ${prop.maximum}.`;
    }
    if (prop.enum && !prop.enum.includes(value)) {
      return `El campo '${key}' tiene un valor no permitido.`;
    }
    return null;
  }

  if (prop.type === "boolean") {
    return typeof value === "boolean" ? null : `El campo '${key}' debe ser booleano.`;
  }

  if (prop.type === "object") {
    // Validación superficial: debe ser un objeto (no arreglo ni null); no se recursa.
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? null
      : `El campo '${key}' debe ser un objeto.`;
  }

  // string
  if (typeof value !== "string") {
    return `El campo '${key}' debe ser texto.`;
  }
  if (prop.format === "uuid" && !UUID_RE.test(value)) {
    return `El campo '${key}' debe ser un UUID válido.`;
  }
  if (prop.pattern && !new RegExp(prop.pattern, "u").test(value)) {
    return `El campo '${key}' no tiene el formato esperado.`;
  }
  if (prop.enum && !prop.enum.includes(value)) {
    return `El campo '${key}' tiene un valor no permitido.`;
  }
  return null;
}

export function validateArgs(schema: ObjectSchema, value: unknown): ValidationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["Los argumentos deben ser un objeto."] };
  }

  const obj = value as Record<string, unknown>;
  const errors: string[] = [];

  for (const key of schema.required ?? []) {
    if (obj[key] === undefined || obj[key] === null) {
      errors.push(`Falta el campo requerido '${key}'.`);
    }
  }

  for (const [key, raw] of Object.entries(obj)) {
    const prop = schema.properties[key];
    if (!prop) {
      if (schema.additionalProperties === false) {
        errors.push(`Campo no permitido '${key}'.`);
      }
      continue;
    }
    if (raw === undefined || raw === null) {
      continue;
    }
    const error = checkProp(key, prop, raw);
    if (error) {
      errors.push(error);
    }
  }

  return { valid: errors.length === 0, errors };
}
