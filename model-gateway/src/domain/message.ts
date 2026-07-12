export type CanonicalRole = "system" | "user" | "assistant" | "tool";

export type CanonicalContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }
  | { type: "file"; mimeType: string; data: string };

export interface CanonicalMessage {
  role: CanonicalRole;
  content: CanonicalContentPart[];
}

export function estimateMessageTokens(messages: readonly CanonicalMessage[]): number {
  const chars = messages.reduce((total, message) => {
    const contentChars = message.content.reduce((nestedTotal, part) => {
      if (part.type === "text") {
        return nestedTotal + part.text.length;
      }

      return nestedTotal + part.data.length;
    }, 0);

    return total + message.role.length + contentChars;
  }, 0);

  return Math.ceil(chars / 4);
}
