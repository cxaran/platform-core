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

// --- Conexión OAuth ChatGPT Plus/Codex (provider openai / credential_type oauth) ---

const OAUTH_BASE = "/api/v1/users/me/ai-providers/oauth/openai";

export interface OAuthStartResponse {
  authorize_url: string;
  state: string;
}

export interface OAuthCompleteRequest {
  code: string;
  state: string;
}

export interface OAuthStatusResponse {
  connected: boolean;
  account_id?: string | null;
  expires_at?: string | null;
}

/** Inicia el flujo OAuth de ChatGPT: devuelve la URL de autorización y el state. */
export function startOpenAiOAuth(): Promise<OAuthStartResponse> {
  return browserApi<OAuthStartResponse>(`${OAUTH_BASE}/start`, { method: "POST" });
}

/** Completa el flujo OAuth con el code+state del callback. */
export function completeOpenAiOAuth(
  payload: OAuthCompleteRequest,
): Promise<OAuthStatusResponse> {
  return browserApi<OAuthStatusResponse>(`${OAUTH_BASE}/complete`, {
    method: "POST",
    body: { ...payload },
  });
}

/** Estado de la conexión OAuth (connected + account_id), sin tokens. */
export function getOpenAiOAuthStatus(): Promise<OAuthStatusResponse> {
  return browserApi<OAuthStatusResponse>(`${OAUTH_BASE}/status`, { method: "GET" });
}

/** Desconecta la cuenta ChatGPT (baja lógica de la credencial OAuth). */
export function disconnectOpenAiOAuth(): Promise<{ message: string }> {
  return browserApi<{ message: string }>(OAUTH_BASE, { method: "DELETE" });
}
