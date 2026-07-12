import { sourceOf } from "./tool-catalog";

import type { ToolDefinition, ToolKind } from "./tools/registry";

/**
 * Búsqueda de tools por INTENCIÓN sobre su metadata (nombre + descripción + procedencia).
 *
 * HONESTIDAD DE PROPÓSITO: hoy NO es un mecanismo de runtime. El copiloto declara al modelo el
 * catálogo EFECTIVO COMPLETO cada turno (ya gateado por rol/permiso); el descubrimiento bajo
 * demanda (las meta-tools ``tool_search``/``tool_describe`` al estilo OpenClaw) se retiró al
 * decidir "declarar todo" y su andamiaje se eliminó. ``searchTools`` se conserva como HARNESS DE
 * QA: las suites de cada familia de tools la usan para verificar que su metadata es localizable
 * por intención (que una descripción pobre no deje una tool "invisible"). Si el catálogo vuelve a
 * crecer hasta necesitar descubrimiento real, este scoring es el punto de partida.
 */

const DEFAULT_SEARCH_LIMIT = 8;

export interface ToolSearchHit {
  name: string;
  kind: ToolKind;
  source: string;
  description: string;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function terms(query: string): string[] {
  return normalize(query)
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 2);
}

/**
 * Busca tools por INTENCIÓN sobre los candidatos (ya filtrados por rol). Puntúa por coincidencia
 * de términos de la consulta en nombre + descripción + procedencia. Las gateadas no llegan aquí
 * porque no están en `candidates`.
 */
export function searchTools(
  query: string,
  candidates: readonly ToolDefinition[],
  limit: number = DEFAULT_SEARCH_LIMIT,
): ToolSearchHit[] {
  const queryTerms = terms(query);
  const scored = candidates
    .map((tool) => {
      const haystack = normalize(`${tool.name} ${tool.description} ${sourceOf(tool)}`);
      // Sin términos (consulta vacía) -> score 1 para devolver el catálogo navegable acotado.
      const score =
        queryTerms.length === 0
          ? 1
          : queryTerms.reduce((sum, term) => (haystack.includes(term) ? sum + 1 : sum), 0);
      return { tool, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, Math.max(1, limit));

  return scored.map(({ tool }) => ({
    name: tool.name,
    kind: tool.kind,
    source: sourceOf(tool),
    description: tool.description,
  }));
}
