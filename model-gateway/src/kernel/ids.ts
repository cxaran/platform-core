import { randomUUID } from "node:crypto";

export type IdPrefix = "bs" | "turn" | "call" | "lease" | "req" | "sess";

export function createId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}
