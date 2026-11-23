import { expect, test } from "bun:test";
import type { ProviderAdapter } from "../src/domain/provider-adapter.js";
import { createGenerationResponse } from "../src/domain/provider-contracts.js";

test("the adapter interface has one neutral operation", () => {
  const adapter = {
    generate: async () =>
      createGenerationResponse({
        content: "hello",
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
      }),
  } satisfies ProviderAdapter;
  expect(Object.keys(adapter)).toEqual(["generate"]);
});
