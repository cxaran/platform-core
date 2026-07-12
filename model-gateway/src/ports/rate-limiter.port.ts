export interface RateLimiterPort {
  acquire(input: { userId: string; profileId: string }): Promise<void>;
  release(input: { userId: string; profileId: string }): Promise<void>;
}
