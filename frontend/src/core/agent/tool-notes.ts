// Notas DETERMINISTAS del uso de herramientas de un turno, para el CONTEXTO de turnos siguientes.
// Módulo PURO (sin red ni React).
//
// Cada tool call del turno (lecturas, meta-tools, MCP, sandbox, ui.*) deja una nota telegráfica que
// se ancla al mensaje del asistente, se persiste con él (payload.tool_notes) y entra al contexto de
// los turnos siguientes como un mensaje de sistema adyacente. A diferencia de las notas de planes
// APROBADOS (segmentos ``preserve``), estas notas son COMPACTABLES: se eliden junto con su mensaje
// cuando la charla vieja se resume. Las notas resumen, no reemplazan: los datos del negocio se releen
// frescos del registro cuando se necesitan (la nota registra QUÉ se consultó, no es la fuente).

import { isUiSpec } from "@/core/agent/tools/ui-spec";

// Topes de la serialización telegráfica: proteger el presupuesto de contexto es el punto.
export const TOOL_NOTE_ARGS_CHARS = 120;
export const TOOL_NOTE_RESULT_CHARS = 200;

/** Resultado de ejecutar una tool (subconjunto estructural del ToolExecutionResult del runner). */
export type ToolNoteOutcome =
  | { status: "success"; content: unknown }
  | { status: "error"; message: string };

/** Serialización compacta de UNA línea con truncado; los arrays anteponen su tamaño (n=…). */
export function briefValue(value: unknown, maxChars: number): string {
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      // JSON.stringify devuelve undefined para undefined/función/símbolo: se cae a String(value).
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  const flat = text.replace(/\s+/g, " ").trim();
  const prefix = Array.isArray(value) ? `[n=${value.length}] ` : "";
  const budget = Math.max(1, maxChars - prefix.length);
  return prefix + (flat.length > budget ? `${flat.slice(0, budget)}…` : flat);
}

/**
 * Nota de una tool call del turno (lectura, meta-tool, MCP, sandbox o ``ui.*``).
 * - Éxito: nombre + args resumidos + resultado resumido.
 * - Tool ``ui.*`` cuyo resultado es un UiSpec: se anota la interfaz mostrada, no el spec completo.
 * - Error (incluye tool desconocida / args inválidos): nombre + args + motivo.
 */
export function buildToolUsageNote(input: {
  name: string;
  args: unknown;
  outcome: ToolNoteOutcome;
}): string {
  const args = briefValue(input.args ?? {}, TOOL_NOTE_ARGS_CHARS);
  if (input.outcome.status === "error") {
    return `Herramienta ${input.name}(${args}) falló: ${briefValue(input.outcome.message, TOOL_NOTE_RESULT_CHARS)}`;
  }
  if (isUiSpec(input.outcome.content)) {
    return `Herramienta ${input.name}(${args}) → interfaz "${input.outcome.content.kind}" mostrada al usuario.`;
  }
  return `Herramienta ${input.name}(${args}) → ${briefValue(input.outcome.content, TOOL_NOTE_RESULT_CHARS)}`;
}

/**
 * Nota INFORMATIVA de una escritura P1 RECHAZADA por el usuario. Deja constancia de la decisión en
 * el contexto para que el modelo no re-proponga lo mismo; compactable (un rechazo viejo pierde
 * relevancia, a diferencia de una escritura ejecutada).
 */
export function buildRejectedWriteNote(plan: {
  actionType: string;
  targetResource: string;
  humanReadableSummary: string;
}): string {
  return (
    `Propuesta de escritura RECHAZADA por el usuario (${plan.actionType} → ${plan.targetResource}): ` +
    `${plan.humanReadableSummary} No volver a proponerla salvo que el usuario lo pida.`
  );
}

/**
 * Bloque de contexto con las notas de un turno (se inyecta como mensaje de sistema adyacente al
 * mensaje del asistente que las ancló). Devuelve null sin notas.
 */
export function toolNotesContextText(notes: readonly string[]): string | null {
  const clean = notes.filter((note) => note.trim().length > 0);
  if (clean.length === 0) {
    return null;
  }
  return `Uso de herramientas de este turno (resumen determinista):\n- ${clean.join("\n- ")}`;
}
