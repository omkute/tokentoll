import { expect, test, spyOn } from "bun:test";
import { adapterContractSuite } from "./adapter-contract-suite.js";
import { createMockProvider } from "../src/adapters/mock-provider.js";
import type {
  ProviderAdapter,
  ProviderInvocation,
} from "../src/domain/provider-adapter.js";
import {
  createGenerationRequest,
  createStreamSequenceValidator,
  type NormalizedStreamEvent,
} from "../src/domain/provider-contracts.js";
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

const streamResponse = {
  content: "Mock response.",
  finishReason: "stop",
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
};

function mockStream(
  adapter: ProviderAdapter,
  streamInvocation: ProviderInvocation = invocation,
): AsyncIterable<NormalizedStreamEvent> {
  const iterable = adapter.stream?.(streamInvocation);
  if (iterable === undefined) {
    throw new Error("mock provider does not implement streaming");
  }
  return iterable;
}

async function collectStream(
  iterable: AsyncIterable<NormalizedStreamEvent>,
): Promise<NormalizedStreamEvent[]> {
  const events: NormalizedStreamEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

test("mock success stream yields the default deltas, usage, and completion", async () => {
  const adapter = createMockProvider({
    outcome: "success",
    response: streamResponse,
  });
  const validator = createStreamSequenceValidator();
  const events: NormalizedStreamEvent[] = [];
  for await (const event of mockStream(adapter)) {
    events.push(validator.accept(event));
  }
  validator.complete();
  expect(events).toEqual([
    { type: "content_delta", delta: "Mock " },
    { type: "content_delta", delta: "response." },
    { type: "usage", usage: streamResponse.usage },
    { type: "completed", finishReason: "stop" },
  ]);
  expect(validator.usage).toEqual(streamResponse.usage);
});

test.each([
  { content: "The quick brown fox", deltas: ["The quick ", "brown fox"] },
  { content: "oneword", deltas: ["oneword"] },
  { content: "", deltas: [] as string[] },
])("mock stream splits %j deterministically", async ({ content, deltas }) => {
  const adapter = createMockProvider({
    outcome: "success",
    response: { ...response, content },
  });
  const events = await collectStream(mockStream(adapter));
  const deltaEvents = events.filter((event) => event.type === "content_delta");
  expect(deltaEvents.map((event) => event.delta)).toEqual(deltas);
  expect(deltaEvents.map((event) => event.delta).join("")).toBe(content);
  expect(events.filter((event) => event.type === "usage")).toEqual([
    { type: "usage", usage: response.usage },
  ]);
  expect(events[events.length - 1]).toEqual({
    type: "completed",
    finishReason: "stop",
  });
});

test("repeated mock streams yield identical event sequences", async () => {
  const adapter = createMockProvider({
    outcome: "success",
    response: streamResponse,
  });
  const first = await collectStream(mockStream(adapter));
  const second = await collectStream(mockStream(adapter));
  expect(second).toEqual(first);
});

test("aborting before iteration yields no events", async () => {
  const controller = new AbortController();
  controller.abort();
  const adapter = createMockProvider({
    outcome: "success",
    response: streamResponse,
  });
  expect(
    await collectStream(
      mockStream(adapter, { ...invocation, signal: controller.signal }),
    ),
  ).toEqual([]);
});

test("aborting after the first delta stops before usage and completion", async () => {
  const adapter = createMockProvider({
    outcome: "success",
    response: streamResponse,
  });
  const controller = new AbortController();
  const events: NormalizedStreamEvent[] = [];
  for await (const event of mockStream(adapter, {
    ...invocation,
    signal: controller.signal,
  })) {
    events.push(event);
    controller.abort();
  }
  expect(events).toEqual([{ type: "content_delta", delta: "Mock " }]);
});

test.each([true, false])(
  "mock stream fails a configured outcome (%s) before the first event",
  async (retryable) => {
    for (const outcome of ["provider_error", "timeout"] as const) {
      const category =
        outcome === "timeout" ? "timeout" : "provider_unavailable";
      const adapter = createMockProvider({
        outcome,
        error: { category, retryable, message: "Safe failure" },
      });
      const iterator = mockStream(adapter)[Symbol.asyncIterator]();
      await expect(iterator.next()).rejects.toMatchObject({
        category,
        retryable,
        message: "Safe failure",
      });
    }
  },
);

test("mock stream validates the invocation before the configured outcome", async () => {
  const foreignDeployment = createModelDeployment({
    deploymentId: "one",
    adapterId: "other",
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
  });
  for (const outcome of ["provider_error", "timeout"] as const) {
    const adapter = createMockProvider({
      outcome,
      error: {
        category: outcome === "timeout" ? "timeout" : "provider_unavailable",
        retryable: false,
        message: "Safe failure",
      },
    });
    for (const invalid of [
      { ...invocation, request: { messages: [] } },
      { ...invocation, deployment: foreignDeployment },
    ]) {
      const iterator = mockStream(adapter, invalid)[Symbol.asyncIterator]();
      await expect(iterator.next()).rejects.toMatchObject({
        category: "invalid_request",
        retryable: false,
        message: "Invalid provider invocation",
      });
    }
  }
});

test("mock streaming uses no network or timers", async () => {
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
                category:
                  outcome === "timeout" ? "timeout" : "provider_unavailable",
                retryable: false,
                message: "Safe failure",
              },
            },
      );
      await collectStream(mockStream(adapter)).catch(() => undefined);
    }
    expect(network).not.toHaveBeenCalled();
    expect(timers).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
    timers.mockRestore();
  }
});
