// Sugerencias de inicio del chat, DERIVADAS de las herramientas realmente disponibles para el
// usuario (no una lista fija). Cada sugerencia declara las tools que la habilitan; solo se ofrece
// si TODAS están disponibles (no gateadas por rol) en el catálogo proyectado por permisos. De las
// elegibles se muestra una SELECCIÓN ALEATORIA. Así el usuario ve atajos pertinentes a lo que su
// rol puede hacer, y no siempre los mismos.
//
// El módulo es PURO: el muestreo aleatorio se inyecta (``shuffle``) para poder testearlo. El
// catálogo de tools (procedencia + gating) ya viene proyectado por permisos desde el cliente
// (``buildToolCatalog`` sobre ``/api/v1/resources``). La lista de candidatas es INYECTABLE: la
// plataforma base trae unas pocas genéricas y el producto puede pasar las suyas.

import type { ToolCatalogEntry } from "./tool-catalog";

export interface SuggestionCandidate {
  /** Texto del prompt sugerido (se inserta en el composer; el usuario lo revisa antes de enviar). */
  readonly text: string;
  /** Tools que deben estar DISPONIBLES (no gateadas) para ofrecer la sugerencia. Vacío = siempre. */
  readonly requires: readonly string[];
}

// Candidatas genéricas de la plataforma base. Solo dependen de tools transversales (`ui.*`), que
// no son de dominio; el producto puede ampliar esta lista con sugerencias propias.
export const DEFAULT_SUGGESTIONS: readonly SuggestionCandidate[] = [
  { text: "¿Qué puedo hacer aquí?", requires: [] },
  { text: "Muéstrame una gráfica con datos de un recurso", requires: ["ui.render_chart"] },
  { text: "Ayúdame a llenar un formulario", requires: ["ui.render_form"] },
];

/** Mezcla Fisher-Yates (in-place sobre una copia). Aleatorio por defecto vía ``Math.random``. */
function fisherYatesShuffle<T>(items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Construye las sugerencias de inicio: filtra las candidatas cuyas tools están TODAS disponibles
 * (no gateadas) en el catálogo, muestrea ``count`` al azar (``shuffle`` inyectable) y devuelve sus
 * textos. Devuelve ``[]`` si no hay elegibles (el caller decide el fallback).
 */
export function buildStartSuggestions(
  catalog: readonly ToolCatalogEntry[],
  count = 4,
  shuffle: <T>(items: readonly T[]) => T[] = fisherYatesShuffle,
  candidates: readonly SuggestionCandidate[] = DEFAULT_SUGGESTIONS,
): string[] {
  const available = new Set(
    catalog.filter((entry) => entry.status !== "gated_out").map((entry) => entry.name),
  );
  const eligible = candidates.filter((candidate) =>
    candidate.requires.every((name) => available.has(name)),
  );
  return shuffle(eligible)
    .slice(0, Math.max(0, count))
    .map((candidate) => candidate.text);
}
