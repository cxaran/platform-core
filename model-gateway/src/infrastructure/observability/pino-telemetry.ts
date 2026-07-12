import pino from "pino";
import { redactValue } from "../../kernel/redact.js";
import type { TelemetryPort } from "../../ports/telemetry.port.js";

export class PinoTelemetry implements TelemetryPort {
  constructor(private readonly logger = pino()) {}

  info(message: string, fields: Record<string, unknown> = {}): void {
    this.logger.info(redactValue(fields), message);
  }

  warn(message: string, fields: Record<string, unknown> = {}): void {
    this.logger.warn(redactValue(fields), message);
  }

  error(message: string, fields: Record<string, unknown> = {}): void {
    this.logger.error(redactValue(fields), message);
  }
}
