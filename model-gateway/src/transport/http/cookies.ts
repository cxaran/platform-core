export function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) {
    return null;
  }

  const parts = header.split(";");
  for (const part of parts) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rawValue.join("="));
    }
  }

  return null;
}

export function createSessionCookie(name: string, value: string, secure: boolean): string {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/model-gateway",
    "Max-Age=1800"
  ];

  if (secure) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function clearSessionCookie(name: string, secure: boolean): string {
  const attributes = [`${name}=`, "HttpOnly", "SameSite=Strict", "Path=/model-gateway", "Max-Age=0"];
  if (secure) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}
