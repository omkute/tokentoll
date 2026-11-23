import type { ProviderAdapter } from "../src/domain/provider-adapter.js";
import { createGenerationResponse } from "../src/domain/provider-contracts.js";

export const adapterFixture = {
  async generate(invocation) {
    return createGenerationResponse({
      content: invocation.request.messages[0]?.content ?? "",
      finishReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    });
  },
} satisfies ProviderAdapter;
