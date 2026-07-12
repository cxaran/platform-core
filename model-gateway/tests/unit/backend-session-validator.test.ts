import { describe, it, expect } from "vitest";

import { HttpBackendSessionValidator } from "../../src/infrastructure/backend-session/http-backend-session.validator.js";

function validator(fetchImpl: typeof fetch): HttpBackendSessionValidator {
  return new HttpBackendSessionValidator({
    backendBaseUrl: "http://backend:8000/",
    cookieName: "session_token",
    fetchImpl
  });
}

describe("HttpBackendSessionValidator", () => {
  it("devuelve la identidad cuando /auth/me responde 200 con id", async () => {
    let calledUrl = "";
    let sentCookie: string | null = null;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calledUrl = url;
      sentCookie = new Headers(init?.headers).get("cookie");
      return { ok: true, json: async () => ({ id: "user-123", email: "a@b.c" }) } as Response;
    }) as unknown as typeof fetch;

    const result = await validator(fetchImpl).validate("jwt-abc");

    expect(result).toEqual({ userId: "user-123" });
    expect(calledUrl).toBe("http://backend:8000/api/v1/auth/me");
    expect(sentCookie).toBe("session_token=jwt-abc");
  });

  it("no llama al backend y devuelve null si la cookie está ausente (fail-closed)", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return { ok: true, json: async () => ({ id: "x" }) } as Response;
    }) as unknown as typeof fetch;

    const result = await validator(fetchImpl).validate(null);

    expect(result).toBeNull();
    expect(called).toBe(false);
  });

  it("devuelve null en 401 (sesión inválida)", async () => {
    const fetchImpl = (async () => ({ ok: false, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    expect(await validator(fetchImpl).validate("jwt")).toBeNull();
  });

  it("devuelve null si el backend es inalcanzable (fail-closed)", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await validator(fetchImpl).validate("jwt")).toBeNull();
  });

  it("devuelve null si la respuesta no trae un id válido", async () => {
    const fetchImpl = (async () => ({ ok: true, json: async () => ({ email: "a@b.c" }) }) as Response) as unknown as typeof fetch;
    expect(await validator(fetchImpl).validate("jwt")).toBeNull();
  });
});
