import test from "node:test";
import assert from "node:assert/strict";

import type { WireMessage, WireModelCapabilities, WireTool } from "@/core/agent/protocol";

import {
  CONTEXT_RECAP_HEADER,
  compactContext,
  consolidateApprovedPlans,
  contextUsage,
  effectiveContextWindow,
  estimateTokens,
  estimateToolSchemaTokens,
  extractClinicalIds,
  MAX_CONSOLIDATED_PLAN_IDS,
  MAX_VERBATIM_PLAN_NOTES,
  PLAN_LEDGER_HEADER,
  usableInputTokens,
  type ContextSegment,
} from "./context-window.ts";

const ID_A = "a1c90cd8-a779-42ea-925f-32b7b372e744";
const ID_B = "bbee3d23-4968-4ca2-acdd-258955d90a82";
const ID_C = "8f64e4f8-405a-47db-a153-afc331c194df";

function msg(role: WireMessage["role"], text: string): WireMessage {
  return { role, content: [{ type: "text", text }] };
}

function seg(text: string, preserve = false): ContextSegment {
  return { messages: [msg("user", text)], text, preserve };
}

function caps(partial: Partial<WireModelCapabilities>): WireModelCapabilities {
  return { context_window_tokens: null, effective_context_tokens: null, ...partial } as WireModelCapabilities;
}

// --- estimación (espejo del gateway: ceil(chars/4)) ---

test("estimateTokens: heurística ~4 chars/token", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("a".repeat(400)), 100);
});

test("estimateToolSchemaTokens: 0 sin tools; ~JSON.length/4 con tools", () => {
  assert.equal(estimateToolSchemaTokens([]), 0);
  const tools: WireTool[] = [{ name: "t", description: "d", input_schema: {}, strict: false }];
  assert.equal(estimateToolSchemaTokens(tools), Math.ceil(JSON.stringify(tools).length / 4));
});

// --- presupuesto desde capabilities ---

test("effectiveContextWindow: menor de los topes informados; 0 si ninguno", () => {
  assert.equal(effectiveContextWindow(caps({ context_window_tokens: 128000, effective_context_tokens: 32000 })), 32000);
  assert.equal(effectiveContextWindow(caps({ context_window_tokens: 8000 })), 8000);
  assert.equal(effectiveContextWindow(caps({})), 0);
});

test("usableInputTokens: ventana − salida − reserva; 0 si no hay ventana", () => {
  assert.equal(usableInputTokens(caps({ effective_context_tokens: 10000 }), 1024, 1024), 10000 - 2048);
  assert.equal(usableInputTokens(caps({}), 1024, 1024), 0);
});

// --- contabilidad para el indicador ---

test("contextUsage: porcentaje, fuente y presupuesto desconocido", () => {
  const u = contextUsage(500, 1000, "estimado");
  assert.equal(u.percent, 50);
  assert.equal(u.source, "estimado");
  assert.equal(u.unknownBudget, false);
  const reported = contextUsage(2000, 1000, "reportado");
  assert.equal(reported.percent, 100); // se acota a 100
  const unknown = contextUsage(10, 0, "estimado");
  assert.equal(unknown.unknownBudget, true);
  assert.equal(unknown.percent, 0);
});

// --- extracción de identificadores clínicos ---

test("extractClinicalIds: UUID únicos, en orden, en minúscula", () => {
  const ids = extractClinicalIds(`paciente ${ID_A.toUpperCase()} y consulta ${ID_B}; otra vez ${ID_A}`);
  assert.deepEqual(ids, [ID_A, ID_B]);
  assert.deepEqual(extractClinicalIds("sin identificadores"), []);
});

// --- compactación ---

test("compactContext: por debajo del umbral no compacta (mensajes intactos)", () => {
  const segments = [seg("hola"), seg("qué tal")];
  const result = compactContext(segments, { usableInputTokens: 1000 });
  assert.equal(result.compacted, false);
  assert.equal(result.recap, null);
  assert.equal(result.messages.length, 2);
});

test("compactContext: sin presupuesto (usable 0) no compacta", () => {
  const result = compactContext([seg("x".repeat(1000))], { usableInputTokens: 0 });
  assert.equal(result.compacted, false);
});

test("compactContext: sobre el umbral resume lo viejo y conserva lo reciente", () => {
  // 4 segmentos de ~20 tokens (80 chars). usable=100, umbral 0.5 -> compacta (total 80>50).
  // reserva reciente 0.5 -> recentBudget=50 -> conserva los 2 últimos (40), elide los 2 primeros.
  const segments = [
    seg(`viejo 1 paciente ${ID_A} ${"x".repeat(40)}`),
    seg(`viejo 2 consulta ${ID_B} ${"x".repeat(40)}`),
    seg(`reciente 1 ${"y".repeat(60)}`),
    seg(`reciente 2 ${"z".repeat(60)}`),
  ];
  const result = compactContext(segments, {
    usableInputTokens: 100,
    threshold: 0.5,
    recentReserveRatio: 0.5,
  });
  assert.equal(result.compacted, true);
  assert.equal(result.droppedSegments, 2);
  // El recap encabeza la salida y conserva los IDs de lo elidido.
  assert.ok(result.recap?.includes(CONTEXT_RECAP_HEADER));
  assert.deepEqual(result.preservedIds, [ID_A, ID_B]);
  const recapText = result.messages[0]?.content[0];
  assert.ok(recapText?.type === "text" && recapText.text.includes(ID_A) && recapText.text.includes(ID_B));
  // Los recientes sobreviven; los viejos ya no aparecen como mensajes propios.
  const joined = result.messages.map((m) => (m.content[0]?.type === "text" ? m.content[0].text : "")).join("\n");
  assert.ok(joined.includes("reciente 2"));
  assert.ok(!joined.includes("viejo 1"));
});

test("compactContext: los planes APROBADOS (preserve) se conservan verbatim, nunca se eliden", () => {
  const approved = { ...seg(`Acción APROBADA receta ${ID_C}`, true) };
  const segments = [
    seg(`viejo paciente ${ID_A} ${"x".repeat(80)}`),
    approved,
    seg(`reciente ${"y".repeat(40)}`),
  ];
  const result = compactContext(segments, {
    usableInputTokens: 100,
    threshold: 0.4,
    recentReserveRatio: 0.3,
  });
  assert.equal(result.compacted, true);
  // El mensaje del plan aprobado se devuelve POR REFERENCIA (verbatim, no reconstruido).
  assert.ok(result.messages.includes(approved.messages[0]!));
});

test("compactContext: nunca parte un par tool-call/tool-result (segmento atómico)", () => {
  const assistantCall = msg("assistant", `Voy a registrar al paciente ${ID_A}`);
  const toolResult = msg("tool", `resultado creado ${ID_A}`);
  const pair: ContextSegment = {
    messages: [assistantCall, toolResult],
    text: `par herramienta ${ID_A} ${"x".repeat(80)}`,
  };
  const segments = [pair, seg(`reciente ${"y".repeat(40)}`), seg(`reciente 2 ${"z".repeat(40)}`)];
  const result = compactContext(segments, {
    usableInputTokens: 100,
    threshold: 0.4,
    recentReserveRatio: 0.3,
  });
  assert.equal(result.compacted, true);
  // El par viejo se elidió ENTERO: ninguno de sus dos mensajes está en la salida.
  assert.ok(!result.messages.includes(assistantCall));
  assert.ok(!result.messages.includes(toolResult));
  // Pero su identificador se conservó en el recap.
  assert.ok(result.preservedIds.includes(ID_A));
});

test("compactContext: es PURO (no muta los segmentos de entrada; el almacén no se toca)", () => {
  const segments = [seg(`viejo ${ID_A} ${"x".repeat(80)}`), seg(`reciente ${"y".repeat(40)}`)];
  const snapshot = JSON.parse(JSON.stringify(segments));
  compactContext(segments, { usableInputTokens: 100, threshold: 0.4, recentReserveRatio: 0.3 });
  // Los segmentos de entrada quedan idénticos (la compactación solo transforma la salida).
  assert.deepEqual(JSON.parse(JSON.stringify(segments)), snapshot);
});

// --- consolidación de planes aprobados (tope determinista de los preserve) ---

const uuidAt = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("consolidateApprovedPlans: bajo el tope, cada nota va verbatim como segmento preserve", () => {
  const notes = ["plan uno", `plan dos con ${ID_A}`];
  const out = consolidateApprovedPlans(notes);
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((s) => ({ text: s.text, preserve: s.preserve })),
    [
      { text: "plan uno", preserve: true },
      { text: `plan dos con ${ID_A}`, preserve: true },
    ],
  );
});

test("consolidateApprovedPlans: sobre el tope, las viejas se consolidan reteniendo sus ids", () => {
  const notes = Array.from(
    { length: MAX_VERBATIM_PLAN_NOTES + 5 },
    (_, i) => `Acción ${i} creó el registro ${uuidAt(i)}.`,
  );
  const out = consolidateApprovedPlans(notes);
  // 1 bloque consolidado + las últimas MAX_VERBATIM_PLAN_NOTES verbatim, todas preserve.
  assert.equal(out.length, 1 + MAX_VERBATIM_PLAN_NOTES);
  assert.ok(out.every((s) => s.preserve === true));
  assert.ok(out[0].text.startsWith(PLAN_LEDGER_HEADER));
  // Los ids de las 5 notas consolidadas sobreviven en el bloque; su texto verbatim no.
  for (let i = 0; i < 5; i += 1) {
    assert.ok(out[0].text.includes(uuidAt(i)));
  }
  assert.ok(!out[0].text.includes("Acción 0 creó"));
  // Las recientes conservan su texto exacto.
  assert.equal(out[1].text, notes[5]);
  assert.equal(out[out.length - 1].text, notes[notes.length - 1]);
});

test("consolidateApprovedPlans: los ids del bloque también se acotan (conserva los recientes)", () => {
  const older = MAX_CONSOLIDATED_PLAN_IDS + 10;
  const notes = Array.from(
    { length: older + MAX_VERBATIM_PLAN_NOTES },
    (_, i) => `Acción ${i} creó el registro ${uuidAt(i)}.`,
  );
  const out = consolidateApprovedPlans(notes);
  const ledger = out[0].text;
  // Los 10 ids más viejos se omiten (con aviso); los siguientes se conservan.
  assert.ok(!ledger.includes(uuidAt(0)));
  assert.ok(!ledger.includes(uuidAt(9)));
  assert.ok(ledger.includes(uuidAt(10)));
  assert.ok(ledger.includes(uuidAt(older - 1)));
  assert.ok(ledger.includes("10 identificador(es)"));
});

test("consolidateApprovedPlans: el costo de contexto queda ACOTADO aunque el hilo crezca", () => {
  const notesOf = (count: number): string[] =>
    Array.from({ length: count }, (_, i) => `Acción ${i} creó el registro ${uuidAt(i)}.`);
  const tokensOf = (segments: readonly ContextSegment[]): number =>
    segments.reduce((sum, s) => sum + estimateTokens(s.text), 0);
  const at100 = tokensOf(consolidateApprovedPlans(notesOf(100)));
  const at1000 = tokensOf(consolidateApprovedPlans(notesOf(1000)));
  // Con 10x más aprobaciones el costo NO se multiplica: sólo varían los conteos del aviso y los
  // dígitos de los índices (sin tope, 900 notas extra costarían miles de tokens).
  assert.ok(at1000 - at100 < 20, `at100=${at100} at1000=${at1000}`);
});
