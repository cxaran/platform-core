import type { WireMessage, WireModelCapabilities, WireTool } from "@/core/agent/protocol";

/**
 * Gestión de la VENTANA DE CONTEXTO del agente (P3, paridad OpenClaw, provider-neutral).
 * Dos responsabilidades, ambas en el NAVEGADOR (que ensambla el contexto del turno y es
 * dueño de la conversación; el gateway sigue provider-neutral y ya valida el presupuesto):
 *
 *  (a) CONTABILIDAD: estimar cuántos tokens ocupa el contexto que se enviará y compararlo
 *      con el presupuesto efectivo negociado del modelo (capabilities B5), para un indicador
 *      "usado / presupuesto". La heurística de estimación (≈4 caracteres/token) es la MISMA
 *      que usa el gateway (``Math.ceil(chars / 4)``), así que el número es consistente con el
 *      que el gateway evaluará al recibir el turno.
 *
 *  (b) COMPACTACIÓN disk-intact: cuando la conversación en contexto se acerca al presupuesto,
 *      se RESUMEN/ELIDEN los intercambios más viejos SIN perder identificadores de negocio. La
 *      compactación afecta SOLO la ventana que ve el modelo; NO toca el almacén de datos
 *      (los datos en FastAPI son la autoridad y quedan intactos; este módulo es PURO, no hace
 *      red). Política de preservación: nunca se resume un identificador (UUID de un registro), los planes APROBADOS se conservan verbatim (segmentos
 *      ``preserve``), y un par tool-call/tool-result nunca se parte (la unidad atómica es el
 *      SEGMENTO, que puede agrupar varios mensajes y se conserva o se descarta entero).
 */

/** Tokens de salida que reservamos (coincide con generation.max_output_tokens del panel). */
export const DEFAULT_MAX_OUTPUT_TOKENS = 1024;
/** Reserva de seguridad (coincide con el default del gateway GATEWAY_SAFETY_RESERVE_TOKENS). */
export const DEFAULT_SAFETY_RESERVE_TOKENS = 1024;
/** Se compacta cuando el input estimado supera esta fracción del presupuesto usable. */
export const DEFAULT_COMPACTION_THRESHOLD = 0.75;
/** Tras compactar, se conservan los intercambios recientes hasta esta fracción del usable. */
export const DEFAULT_RECENT_RESERVE_RATIO = 0.5;

/** Delimitador del bloque de resumen de contexto previo (claramente identificable). */
export const CONTEXT_RECAP_HEADER = "RESUMEN DE CONTEXTO PREVIO (compactado)";

/** Estimación de tokens de un texto: misma heurística que el gateway (≈4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimación de tokens del esquema de tools declarado (espejo del gateway). */
export function estimateToolSchemaTokens(tools: readonly WireTool[]): number {
  if (tools.length === 0) {
    return 0;
  }
  return Math.ceil(JSON.stringify(tools).length / 4);
}

/** Texto plano de un mensaje de cable. SOLO partes de texto: las imágenes NO entran a la
 *  estimación de tokens (limitación conocida — un adjunto grande consume contexto real del
 *  proveedor sin reflejarse en el presupuesto local). */
export function messageText(message: WireMessage): string {
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join(" ");
}

/**
 * Ventana de contexto EFECTIVA del modelo a partir de sus capabilities (B5): el menor de los
 * topes informados (cap efectivo y ventana total). 0 si el modelo no informa ninguno.
 */
export function effectiveContextWindow(capabilities: WireModelCapabilities | undefined): number {
  if (!capabilities) {
    return 0;
  }
  const windows = [capabilities.effective_context_tokens, capabilities.context_window_tokens].filter(
    (value): value is number => typeof value === "number" && value > 0,
  );
  return windows.length > 0 ? Math.min(...windows) : 0;
}

/**
 * Tokens de entrada usables = ventana efectiva − salida reservada − reserva de seguridad
 * (espejo del ContextBudgeter del gateway). 0 si no hay ventana informada.
 */
export function usableInputTokens(
  capabilities: WireModelCapabilities | undefined,
  maxOutputTokens: number = DEFAULT_MAX_OUTPUT_TOKENS,
  safetyReserveTokens: number = DEFAULT_SAFETY_RESERVE_TOKENS,
): number {
  const window = effectiveContextWindow(capabilities);
  if (window <= 0) {
    return 0;
  }
  return Math.max(0, window - maxOutputTokens - safetyReserveTokens);
}

/** Contabilidad de contexto para el indicador. */
export interface ContextUsage {
  used: number;
  budget: number;
  /** Porcentaje 0–100 (0 si no hay presupuesto informado). */
  percent: number;
  /** ``reportado`` si viene del usage del gateway; ``estimado`` si es heurístico local. */
  source: "reportado" | "estimado";
  /** ``true`` cuando el modelo no informa ventana de contexto. */
  unknownBudget: boolean;
}

/** Construye la contabilidad usado/presupuesto para el indicador. */
export function contextUsage(
  used: number,
  budget: number,
  source: "reportado" | "estimado",
): ContextUsage {
  const unknownBudget = budget <= 0;
  const percent = unknownBudget ? 0 : Math.min(100, Math.round((used / budget) * 100));
  return { used, budget, percent, source, unknownBudget };
}

/** Segmento atómico de conversación: se conserva o se descarta ENTERO (nunca se parte). */
export interface ContextSegment {
  /** Mensajes de cable que componen el segmento (p. ej. un par tool-call/tool-result). */
  messages: WireMessage[];
  /** Texto representativo para estimar tokens y extraer identificadores. */
  text: string;
  /** Si ``true`` nunca se elide (planes aprobados, datos fijados). */
  preserve?: boolean;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Extrae identificadores de negocio (UUID) únicos del texto, en orden de aparición. */
export function extractClinicalIds(text: string): string[] {
  const matches = text.match(UUID_RE) ?? [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const raw of matches) {
    const id = raw.toLowerCase();
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/** Planes aprobados RECIENTES que se conservan verbatim; los más viejos se consolidan. */
export const MAX_VERBATIM_PLAN_NOTES = 12;
/** Tope de identificadores de negocio en el bloque consolidado (se conservan los más recientes). */
export const MAX_CONSOLIDATED_PLAN_IDS = 40;

/** Encabezado del bloque consolidado de acciones de escritura previas (claramente identificable). */
export const PLAN_LEDGER_HEADER = "REGISTRO CONSOLIDADO DE ACCIONES CLÍNICAS PREVIAS";

/**
 * Convierte las notas de planes APROBADOS en segmentos ``preserve`` con TOPE determinista: las
 * últimas ``MAX_VERBATIM_PLAN_NOTES`` van verbatim (una por segmento) y las más viejas se
 * CONSOLIDAN en un solo bloque que retiene sus identificadores de negocio (deduplicados y también
 * acotados a ``MAX_CONSOLIDATED_PLAN_IDS``, conservando los más recientes). Así el costo de
 * contexto de las aprobaciones queda ACOTADO aunque el hilo acumule cientos: el detalle completo
 * vive en el registro (FastAPI es la autoridad) y en el historial persistido del chat; este
 * módulo es PURO y sólo decide qué ve el modelo.
 */
export function consolidateApprovedPlans(notes: readonly string[]): ContextSegment[] {
  const toSegment = (text: string): ContextSegment => ({
    messages: [{ role: "system", content: [{ type: "text", text }] }],
    text,
    preserve: true,
  });

  if (notes.length <= MAX_VERBATIM_PLAN_NOTES) {
    return notes.map(toSegment);
  }

  const older = notes.slice(0, notes.length - MAX_VERBATIM_PLAN_NOTES);
  const recent = notes.slice(notes.length - MAX_VERBATIM_PLAN_NOTES);

  const ids = extractClinicalIds(older.join("\n"));
  const shownIds = ids.slice(-MAX_CONSOLIDATED_PLAN_IDS);
  const omittedIds = ids.length - shownIds.length;

  const lines = [
    PLAN_LEDGER_HEADER,
    `Se consolidaron ${older.length} acción(es) de negocio(s) aprobada(s) y ejecutada(s) más ` +
      "antigua(s) para no exceder el contexto. El registro en el servidor es la autoridad: " +
      "consúltalo si necesitas el detalle de alguna.",
  ];
  if (shownIds.length > 0) {
    lines.push("Identificadores de negocio de esas acciones:");
    for (const id of shownIds) {
      lines.push(`- ${id}`);
    }
  }
  if (omittedIds > 0) {
    lines.push(
      `(y ${omittedIds} identificador(es) más antiguo(s) omitido(s); búscalos en el registro)`,
    );
  }

  return [toSegment(lines.join("\n")), ...recent.map(toSegment)];
}

export interface CompactionOptions {
  usableInputTokens: number;
  /** Tokens fijos de overhead (esquema de tools + bloque de memorias/sistema). */
  overheadTokens?: number;
  threshold?: number;
  recentReserveRatio?: number;
}

export interface CompactionResult {
  /** Mensajes finales a enviar (recap + preservados + recientes, en orden original). */
  messages: WireMessage[];
  compacted: boolean;
  /** Texto del recap inyectado (null si no se compactó). */
  recap: string | null;
  /** Identificadores de negocio conservados en el recap. */
  preservedIds: string[];
  /** Cantidad de segmentos elididos (resumidos). */
  droppedSegments: number;
}

/**
 * Compacta la conversación en contexto si su tamaño estimado supera el umbral del presupuesto
 * usable. Conserva SIEMPRE los segmentos ``preserve`` (planes aprobados) y los más RECIENTES
 * que quepan en la reserva reciente; resume los más viejos en UN bloque de recap que retiene
 * los identificadores de negocio verbatim. PURA: no toca el almacén de datos.
 */
export function compactContext(
  segments: readonly ContextSegment[],
  options: CompactionOptions,
): CompactionResult {
  const overhead = options.overheadTokens ?? 0;
  const threshold = options.threshold ?? DEFAULT_COMPACTION_THRESHOLD;
  const recentRatio = options.recentReserveRatio ?? DEFAULT_RECENT_RESERVE_RATIO;
  const usable = options.usableInputTokens;

  const flatten = (segs: readonly ContextSegment[]): WireMessage[] =>
    segs.flatMap((segment) => segment.messages);

  const totalTokens = overhead + segments.reduce((sum, s) => sum + estimateTokens(s.text), 0);

  // Sin presupuesto informado o por debajo del umbral: no se compacta.
  if (usable <= 0 || totalTokens <= usable * threshold) {
    return {
      messages: flatten(segments),
      compacted: false,
      recap: null,
      preservedIds: [],
      droppedSegments: 0,
    };
  }

  const recentBudget = Math.max(0, usable * recentRatio - overhead);

  // Recorre de lo más nuevo a lo más viejo: conserva los recientes que quepan; los
  // ``preserve`` se conservan siempre (no consumen el presupuesto reciente). El resto se elide.
  const keptIdx = new Set<number>();
  let recentTokens = 0;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i]!;
    if (segment.preserve) {
      keptIdx.add(i);
      continue;
    }
    const cost = estimateTokens(segment.text);
    // Conserva al menos el último intercambio aunque por sí solo exceda la reserva reciente.
    const isLast = i === segments.length - 1;
    if (recentTokens + cost <= recentBudget || (isLast && keptIdx.size === 0)) {
      keptIdx.add(i);
      recentTokens += cost;
    }
  }

  const elided = segments.filter((_, i) => !keptIdx.has(i));
  if (elided.length === 0) {
    // Nada que elidir (todo es preservado/reciente): se devuelve tal cual.
    return {
      messages: flatten(segments),
      compacted: false,
      recap: null,
      preservedIds: [],
      droppedSegments: 0,
    };
  }

  const elidedText = elided.map((segment) => segment.text).join("\n");
  const preservedIds = extractClinicalIds(elidedText);

  const recapLines = [
    CONTEXT_RECAP_HEADER,
    `Se resumieron ${elided.length} intercambio(s) anterior(es) para no exceder el contexto del ` +
      `modelo. Los datos del registro en el servidor NO se modificaron.`,
  ];
  if (preservedIds.length > 0) {
    recapLines.push("Identificadores de negocio conservados:");
    for (const id of preservedIds) {
      recapLines.push(`- ${id}`);
    }
  }
  const recap = recapLines.join("\n");
  const recapMessage: WireMessage = { role: "system", content: [{ type: "text", text: recap }] };

  // Reensamblado: recap primero, luego los segmentos conservados en su ORDEN original.
  const kept = segments.filter((_, i) => keptIdx.has(i));
  const messages = [recapMessage, ...flatten(kept)];

  return { messages, compacted: true, recap, preservedIds, droppedSegments: elided.length };
}
