import type { ModelDescriptor } from "./model.js";

export interface ContextBudgetRequest {
  model: ModelDescriptor;
  requestedMaxOutputTokens: number;
  profileMaxInputTokens: number | null;
  gatewayGlobalMaxContextTokens: number;
  estimatedMessageTokens: number;
  estimatedToolSchemaTokens: number;
  estimatedSystemTokens: number;
  safetyReserveTokens: number;
}

export interface ContextBudgetResult {
  effectiveContextWindow: number;
  usableInputTokens: number;
  estimatedInputTokens: number;
  requestedOutputTokens: number;
  fits: boolean;
  overflowTokens: number;
  confidence: "exact" | "estimated";
}

export class ContextBudgeter {
  assess(request: ContextBudgetRequest): ContextBudgetResult {
    const windows = [
      request.model.capabilities.contextWindowTokens,
      // Cap efectivo (B5): si está definido, también acota la ventana usable.
      request.model.capabilities.effectiveContextTokens,
      request.profileMaxInputTokens,
      request.gatewayGlobalMaxContextTokens
    ].filter((value): value is number => typeof value === "number");

    const effectiveContextWindow = Math.min(...windows);
    const usableInputTokens = Math.max(
      0,
      effectiveContextWindow - request.requestedMaxOutputTokens - request.safetyReserveTokens
    );
    const estimatedInputTokens =
      request.estimatedMessageTokens +
      request.estimatedToolSchemaTokens +
      request.estimatedSystemTokens;
    const overflowTokens = Math.max(0, estimatedInputTokens - usableInputTokens);

    return {
      effectiveContextWindow,
      usableInputTokens,
      estimatedInputTokens,
      requestedOutputTokens: request.requestedMaxOutputTokens,
      fits: overflowTokens === 0,
      overflowTokens,
      confidence: request.model.capabilities.tokenCounting.exact === "supported" ? "exact" : "estimated"
    };
  }
}
