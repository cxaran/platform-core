import { describe, expect, it, vi } from "vitest";
import { InMemoryBrowserSessionStore } from "../../src/application/browser-sessions/session-store.js";

describe("InMemoryBrowserSessionStore", () => {
  it("create genera una sesion con id 'bs_', userId por defecto y TTL de 30 min", () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-01-01T00:00:00.000Z");
      vi.setSystemTime(now);
      const store = new InMemoryBrowserSessionStore();
      const session = store.create();
      expect(session.id.startsWith("bs_")).toBe(true);
      expect(session.userId).toBe("dev-user");
      expect(session.createdAt.getTime()).toBe(now.getTime());
      expect(session.expiresAt.getTime()).toBe(now.getTime() + 30 * 60_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("create acepta un userId explicito", () => {
    const store = new InMemoryBrowserSessionStore();
    const session = store.create("user-42");
    expect(session.userId).toBe("user-42");
  });

  it("get devuelve la sesion vigente y null para una inexistente", () => {
    const store = new InMemoryBrowserSessionStore();
    const session = store.create();
    expect(store.get(session.id)?.id).toBe(session.id);
    expect(store.get("bs_inexistente")).toBeNull();
  });

  it("get devuelve null para una sesion expirada", () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryBrowserSessionStore();
      const session = store.create();
      expect(store.get(session.id)?.id).toBe(session.id);
      vi.advanceTimersByTime(30 * 60_000 + 1);
      expect(store.get(session.id)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("delete elimina la sesion (get posterior -> null)", () => {
    const store = new InMemoryBrowserSessionStore();
    const session = store.create();
    store.delete(session.id);
    expect(store.get(session.id)).toBeNull();
  });
});
