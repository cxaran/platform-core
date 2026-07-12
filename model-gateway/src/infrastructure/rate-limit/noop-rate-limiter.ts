import type { RateLimiterPort } from "../../ports/rate-limiter.port.js";

export class NoopRateLimiter implements RateLimiterPort {
  async acquire(): Promise<void> {
    return;
  }

  async release(): Promise<void> {
    return;
  }
}
