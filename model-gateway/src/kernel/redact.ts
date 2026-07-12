const SECRET_KEY_PATTERN = /api[_-]?key|authorization|cookie|credential|secret|token|password|lease|prompts?|messages?|tool[_-]?results?|arguments?/i;

export function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const redacted: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(value)) {
    redacted[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactValue(nested);
  }

  return redacted;
}
