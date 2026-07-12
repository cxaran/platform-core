"use client";

// Cliente de las credenciales de proveedor de IA del usuario autenticado (owner-only).
// El secreto en claro SOLO viaja como entrada (create/update); el backend lo cifra en
// reposo y nunca lo devuelve.

import { browserApi } from "@/core/api/browser-client";

export type AiProvider = "openai" | "anthropic" | "gemini" | "openrouter" | "ollama";

export const AI_PROVIDER_LABELS: ReadonlyArray<readonly [AiProvider, string]> = [
  ["openai", "OpenAI"],
  ["anthropic", "Anthropic"],
  ["gemini", "Google Gemini"],
  ["openrouter", "OpenRouter"],
  ["ollama", "Ollama (local)"],
];

export interface AiProviderCredential {
  id: string;
  provider: AiProvider;
  credential_type: "api_key" | "oauth";
  label: string;
  is_active: boolean;
  default_model: string | null;
  created_at: string;
  updated_at: string | null;
}

const BASE = "/api/v1/users/me/ai-providers";

export function listAiCredentials(): Promise<AiProviderCredential[]> {
  return browserApi<AiProviderCredential[]>(BASE, { method: "GET" });
}

export function createAiCredential(input: {
  provider: AiProvider;
  label: string;
  secret: string;
  default_model?: string | null;
}): Promise<AiProviderCredential> {
  return browserApi<AiProviderCredential>(BASE, { method: "POST", body: input });
}

export function updateAiCredential(
  id: string,
  input: Partial<{ label: string; secret: string; default_model: string | null; is_active: boolean }>,
): Promise<AiProviderCredential> {
  return browserApi<AiProviderCredential>(`${BASE}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
  });
}

export function deleteAiCredential(id: string): Promise<{ message: string }> {
  return browserApi<{ message: string }>(`${BASE}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
