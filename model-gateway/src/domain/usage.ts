export interface TurnUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  // Tokens de entrada servidos desde caché (cache READ). El proveedor lo reporta cuando aplica.
  cachedInputTokens: number | null;
  // Tokens de CREACIÓN de caché (cache WRITE). Solo algunos proveedores lo reportan (p. ej.
  // Anthropic cache_creation_input_tokens); el resto queda null (desconocido honesto).
  cacheWriteTokens: number | null;
}

export const emptyTurnUsage = (): TurnUsage => ({
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
  cacheWriteTokens: null
});
