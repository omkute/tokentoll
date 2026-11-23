import { createMockProvider } from "./adapters/mock-provider.js";
import { createModelDeployment } from "./domain/model-deployment.js";

export function createMockChat() {
  return Object.freeze({
    deployment: createModelDeployment({
      deploymentId: "mock-chat-deployment",
      adapterId: "mock",
      providerModelId: "mock-chat-model",
      capabilities: ["generation", "streaming"],
      contextWindowTokens: 131_072,
      prices: {
        currency: "USD",
        unit: "micros_per_million_tokens",
        input: 0,
        output: 0,
        cacheRead: 0,
      },
      enabled: true,
    }),
    adapter: createMockProvider({
      outcome: "success",
      response: {
        content: "Mock response.",
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
      },
    }),
  });
}
