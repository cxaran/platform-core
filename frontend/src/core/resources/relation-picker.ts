import type { ResourceRow } from "@/core/resources/list-types";

/**
 * Resolución de un campo FK (clave foránea) a su recurso destino, para el selector de
 * relación del formulario genérico (F5). El backend NO declara hoy el recurso destino de
 * un campo de formulario (``ResourceFormFieldCapability`` no lleva esa metadata), así que
 * se infiere por el NOMBRE del campo. Si en el futuro el contrato la declarara, esta capa
 * sería el único punto a cambiar; el resto (búsqueda, render) ya es genérico.
 *
 * Mecanismo genérico, no por pantalla: cualquier formulario cuyo campo ``text`` se llame
 * como una de estas FK obtiene el selector. Las FK aún no mapeadas (appointment_id,
 * related_diagnosis_id, prescription_id…) caen al input de texto manual (sin regresión).
 */
export type RelationTarget = {
  /** Nombre del campo FK en el formulario (p. ej. ``patient_id``). */
  field: string;
  /** Nombre del recurso destino en el registry (p. ej. ``patients``). */
  resource: string;
  /** Campos candidatos a etiqueta visible, en orden de preferencia. */
  labelFields: string[];
  /** Campos candidatos a un identificador secundario (folio, especialidad…). */
  secondaryFields: string[];
};

// Mapa nombre-de-campo -> recurso destino. Cada dominio registra aquí sus FK; cada
// entrada reutiliza el mismo relation-search-client genérico (api_path + búsqueda del
// recurso destino); las etiquetas caen al id si el campo elegido no viene en la fila.
const RELATION_TARGETS: Readonly<Record<string, Omit<RelationTarget, "field">>> = {
  user_id: {
    resource: "users",
    labelFields: ["full_name", "name", "email"],
    secondaryFields: ["email"],
  },
};
// Campos de AUDITORÍA: aunque terminen en "_by" y apunten a usuarios, NO son relaciones
// elegibles por el usuario (los fija el backend). Se dejan SIN mapear -> input de texto.

/** Recurso destino de un campo FK, o ``null`` si no hay mapeo (input manual de texto). */
export function resolveRelationTarget(fieldName: string): RelationTarget | null {
  const def = RELATION_TARGETS[fieldName];
  return def ? { field: fieldName, ...def } : null;
}

/** Identificador (UUID) de un item del recurso destino, o ``null`` si falta. */
export function relationItemId(item: ResourceRow): string | null {
  const id = item.id;
  if (typeof id === "string") {
    return id;
  }
  return id == null ? null : String(id);
}

// Primer valor de texto no vacío entre una lista de campos candidatos.
function firstNonEmpty(item: ResourceRow, fields: readonly string[]): string | null {
  for (const field of fields) {
    const value = item[field];
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return null;
}

/** Etiqueta legible de un item: primer ``labelField`` con valor; cae al id. */
export function relationItemLabel(item: ResourceRow, target: RelationTarget): string {
  return firstNonEmpty(item, target.labelFields) ?? relationItemId(item) ?? "(sin etiqueta)";
}

/** Identificador secundario (folio/especialidad/fecha) para desambiguar, o ``null``. */
export function relationItemSecondary(item: ResourceRow, target: RelationTarget): string | null {
  return firstNonEmpty(item, target.secondaryFields);
}
