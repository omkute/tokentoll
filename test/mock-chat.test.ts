import { expect, spyOn, test } from "bun:test";
import { createMockChat } from "../src/mock-chat.js";
import { createGenerationRequest } from "../src/domain/provider-contracts.js";

test("fixed deployment and synthetic outcomes need no external resources", async () => {
  const network = spyOn(globalThis, "fetch");
  const timers = spyOn(globalThis, "setTimeout");
  try {
    const { deployment, adapter } = createMockChat();
    expect(deployment).toEqual({
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
    });
    expect(Object.isFrozen(deployment)).toBe(true);
    for (const content of [
      "Hello",
      "Completely different text",
      "SECRET-PROMPT",
    ]) {
      const request = createGenerationRequest({
        messages: [{ role: "user", content }],
        maxOutputTokens: 1,
      });
      expect(await adapter.generate({ deployment, request })).toEqual({
        content: "Mock response.",
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
      });
    }
    expect(network).not.toHaveBeenCalled();
    expect(timers).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
    timers.mockRestore();
  }
});
