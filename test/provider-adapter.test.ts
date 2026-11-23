import { expect, test } from "bun:test";
import type {
  ProviderAdapter,
  ProviderInvocation,
} from "../src/domain/provider-adapter.js";
import {
  createGenerationRequest,
  createGenerationResponse,
  createStreamEvent,
  type NormalizedStreamEvent,
} from "../src/domain/provider-contracts.js";
import { createModelDeployment } from "../src/domain/model-deployment.js";

const response = createGenerationResponse({
  content: "hello",
  finishReason: "stop",
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
});

const invocation: ProviderInvocation = {
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

test("an adapter implementing only generate satisfies the interface", () => {
  const adapter = {
    generate: async () => response,
  } satisfies ProviderAdapter;
  expect(Object.keys(adapter)).toEqual(["generate"]);
  expect(adapter.stream).toBeUndefined();
});

test("an adapter implementing generate and stream satisfies the interface", async () => {
  const adapter = {
    generate: async () => response,
    async *stream(): AsyncIterable<NormalizedStreamEvent> {
      yield createStreamEvent({ type: "content_delta", delta: "hel" });
      yield createStreamEvent({ type: "content_delta", delta: "lo" });
      yield createStreamEvent({
        type: "usage",
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
      });
      yield createStreamEvent({ type: "completed", finishReason: "stop" });
    },
  } satisfies ProviderAdapter;
  expect(Object.keys(adapter).sort()).toEqual(["generate", "stream"]);
  const events: NormalizedStreamEvent[] = [];
  for await (const event of adapter.stream?.(invocation) ?? []) {
    events.push(event);
  }
  expect(events.map((event) => event.type)).toEqual([
    "content_delta",
    "content_delta",
    "usage",
    "completed",
  ]);
});

test("an invocation accepts an optional cancellation signal", async () => {
  const controller = new AbortController();
  const withoutSignal: ProviderInvocation = invocation;
  const withSignal: ProviderInvocation = {
    ...invocation,
    signal: controller.signal,
  };
  expect(withoutSignal.signal).toBeUndefined();
  expect(withSignal.signal).toBe(controller.signal);
  expect(withSignal.signal?.aborted).toBe(false);
  controller.abort();
  expect(withSignal.signal?.aborted).toBe(true);
  const adapter = {
    generate: async () => response,
    async *stream(
      invocation: ProviderInvocation,
    ): AsyncIterable<NormalizedStreamEvent> {
      if (invocation.signal?.aborted) return;
      yield createStreamEvent({ type: "content_delta", delta: "hello" });
    },
  } satisfies ProviderAdapter;
  const types: string[] = [];
  for await (const event of adapter.stream?.(withSignal) ?? []) {
    types.push(event.type);
  }
  expect(types).toEqual([]);
});
