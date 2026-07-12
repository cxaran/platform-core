import type { CapabilityPolicy } from "../application/capabilities/capability-negotiator.js";
import type { ProviderCredentialLease } from "./provider-adapter.port.js";

export interface TurnAuthorization {
  userId: string;
  sessionId: string;
  tenantId: string | null;
  profileId: string;
  providerId: string;
  credentialId: string;
  modelId: string;
  allowedCapabilities: CapabilityPolicy;
  limits: {
    maxConcurrentTurns: number;
    maxInputTokens: number | null;
    maxOutputTokens: number | null;
    maxTurnDurationSeconds: number;
    maxToolResultBytes: number;
  };
}

export interface ControlPlanePort {
  authorizeTurn(input: { browserSessionId: string; profileId: string }): Promise<TurnAuthorization>;
  leaseCredential(input: { authorization: TurnAuthorization; purpose: "model_turn" }): Promise<ProviderCredentialLease>;
  // Arrienda la credencial de un proveedor concreto del usuario para DESCUBRIR sus modelos
  // (consultar /models del proveedor). Devuelve null si el usuario no tiene credencial para
  // ese proveedor (no es un error: ese proveedor simplemente no se ofrece).
  leaseCredentialForProvider(input: {
    userId: string;
    providerId: string;
  }): Promise<ProviderCredentialLease | null>;
  releaseCredentialLease(leaseId: string): Promise<void>;
  reportTurnUsage(input: { turnId: string; authorization: TurnAuthorization; usage: unknown }): Promise<void>;
}
