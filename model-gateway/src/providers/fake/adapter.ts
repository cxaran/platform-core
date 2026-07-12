import { createId } from "../../kernel/ids.js";
import { createFakeModel } from "../../domain/model.js";
import type { ProviderAdapter, ProviderResumeInput, ProviderTurnInput } from "../../ports/provider-adapter.port.js";
import type { ProviderEvent } from "../../ports/provider-adapter.port.js";

export class FakeProviderAdapter implements ProviderAdapter {
  readonly protocol = "fake" as const;

  async discoverModels(): Promise<ReturnType<typeof createFakeModel>[]> {
    return [createFakeModel()];
  }

  async *startTurn(input: ProviderTurnInput): AsyncIterable<ProviderEvent> {
    input.signal.throwIfAborted();
    yield { type: "text.delta", delta: "Encontré " };

    if (input.tools.length > 0) {
      const firstTool = input.tools[0];
      if (!firstTool) {
        return;
      }

      yield {
        type: "tool_call.ready",
        continuationState: { fake: true },
        call: {
          callId: createId("call"),
          name: firstTool.name,
          arguments: { limit: 3 }
        }
      };
      return;
    }

    yield { type: "text.delta", delta: "una respuesta sin herramientas." };
    yield {
      type: "completed",
      usage: { inputTokens: 12, outputTokens: 8, cachedInputTokens: 0, cacheWriteTokens: 0 }
    };
  }

  async *resumeTurn(input: ProviderResumeInput): AsyncIterable<ProviderEvent> {
    input.signal.throwIfAborted();
    yield { type: "text.delta", delta: `${input.toolResults.length} resultado de herramienta. ` };
    yield { type: "text.delta", delta: "Turno finalizado." };
    yield {
      type: "completed",
      usage: { inputTokens: 24, outputTokens: 12, cachedInputTokens: 0, cacheWriteTokens: 0 }
    };
  }
}
