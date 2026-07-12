export class GatewayError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export function toGatewayError(error: unknown): GatewayError {
  if (error instanceof GatewayError) {
    return error;
  }

  if (error instanceof Error) {
    return new GatewayError("INTERNAL_ERROR", error.message);
  }

  return new GatewayError("INTERNAL_ERROR", "Unexpected gateway error");
}
