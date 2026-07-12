import { createId } from "../../kernel/ids.js";
import type { BrowserSession } from "../../domain/gateway-session.js";

export class InMemoryBrowserSessionStore {
  private readonly sessions = new Map<string, BrowserSession>();

  create(userId = "dev-user", sessionRef = ""): BrowserSession {
    const now = new Date();
    const session: BrowserSession = {
      id: createId("bs"),
      userId,
      sessionRef,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 30 * 60_000)
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): BrowserSession | null {
    const session = this.sessions.get(id) ?? null;
    if (!session || session.expiresAt.getTime() < Date.now()) {
      return null;
    }

    return session;
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }
}
