/**
 * Saneo CANÓNICO de nombres de tool para el cable de los proveedores.
 *
 * Varias familias de cable (OpenAI/DeepSeek chat/completions, Codex Responses, Anthropic
 * Messages, Gemini function calling) exigen nombres de función `^[a-zA-Z0-9_-]{1,64}$`:
 * NO admiten el punto de nuestros namespaces ("example.search_patients", "ui.render_form")
 * ni nombres de más de 64 caracteres.
 *
 * El saneo se aplica SOLO en el cable (tools declaradas y tool calls del historial
 * reenviado); la tool call emitida al navegador REVIERTE al nombre ORIGINAL vía el mapa
 * inverso (`buildWireToolNameMap`). Como el saneo es determinista, re-sanear el historial
 * al reanudar reproduce exactamente lo que el proveedor generó.
 */

/** Reemplaza cualquier carácter fuera de [a-zA-Z0-9_-] por '_' y trunca a 64. */
export function sanitizeWireToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

/**
 * Mapa inverso saneado→original para recuperar el nombre real de la tool call que emite el
 * proveedor (que solo conoce el saneado). Si dos nombres colisionan al sanear (caso teórico
 * improbable con el namespacing por '.'), gana el último.
 */
export function buildWireToolNameMap(names: readonly string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const name of names) {
    map[sanitizeWireToolName(name)] = name;
  }
  return map;
}
