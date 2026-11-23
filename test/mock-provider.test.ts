import { expect, test, spyOn } from "bun:test";
import { adapterContractSuite } from "./adapter-contract-suite.js";
import { createMockProvider } from "../src/adapters/mock-provider.js";
import { createGenerationRequest } from "../src/domain/provider-contracts.js";
import { createModelDeployment } from "../src/domain/model-deployment.js";

export const invocation = {
  request: createGenerationRequest({
    messages: [{ role: "user", content: "hello" }],
  }),
  deployment: createModelDeployment({
    deploymentId: "one",
    adapterId: "mock",
    providerModelId: "model",
    capabilities: ["generation"],
    contextWindowTokens: 100,
    prices: {
      currency: "USD",
      unit: "micros_per_million_tokens",
      input: 0,
      output: 0,
      cacheRead: 0,
    },
  }),
};
export const response = {
  content: "hello",
  finishReason: "stop",
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
};

test("mock success repeats and freezes its configured response", async () => {
  const adapter = createMockProvider({ outcome: "success", response });
  const first = await adapter.generate(invocation);
  expect(first).toEqual(response);
  expect(await adapter.generate(invocation)).toEqual(first);
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first.usage)).toBe(true);
});

test("incomplete mock configuration fails during construction", () => {
  expect(() => createMockProvider({ outcome: "success" })).toThrow();
});

test("mock invocation uses no network or timers", async () => {
  const network = spyOn(globalThis, "fetch");
  const timers = spyOn(globalThis, "setTimeout");
  try {
    for (const outcome of ["success", "provider_error", "timeout"] as const) {
      const adapter = createMockProvider(
        outcome === "success"
          ? { outcome, response }
          : {
              outcome,
              error: {
                category: outcome,
                retryable: false,
                message: "Safe failure",
              },
            },
      );
      await adapter.generate(invocation).catch(() => undefined);
    }
    expect(network).not.toHaveBeenCalled();
    expect(timers).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
    timers.mockRestore();
  }
});

adapterContractSuite(
  "mock adapter contract",
  (outcome, retryable) =>
    createMockProvider(
      outcome === "success"
        ? { outcome, response }
        : {
            outcome,
            error: { category: outcome, retryable, message: "Safe failure" },
          },
    ),
  invocation,
);

test.each([true, false])(
  "mock failures preserve retryability %s",
  async (retryable) => {
    for (const outcome of ["provider_error", "timeout"]) {
      const category =
        outcome === "timeout" ? "timeout" : "provider_unavailable";
      const adapter = createMockProvider({
        outcome,
        error: { category, retryable, message: "Safe failure" },
      });
      try {
        await adapter.generate(invocation);
        throw new Error("Expected failure");
      } catch (error) {
        expect(error).toMatchObject({
          category,
          retryable,
          message: "Safe failure",
        });
      }
      await expect(
        adapter.generate({ ...invocation, request: { messages: [] } }),
      ).rejects.toMatchObject({
        category: "invalid_request",
        retryable: false,
      });
    }
  },
);
