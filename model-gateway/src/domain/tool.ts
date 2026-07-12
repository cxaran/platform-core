export interface ModelToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  strict: boolean;
}

export interface ToolCallRequest {
  callId: string;
  name: string;
  arguments: unknown;
}

export interface ToolCallResult {
  callId: string;
  result:
    | {
        status: "success";
        content: unknown;
      }
    | {
        status: "error";
        code: string;
        message: string;
      };
}
