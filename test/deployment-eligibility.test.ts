import { describe, expect, test } from "bun:test";

import { createDeploymentCatalog } from "../src/domain/deployment-catalog.js";
import {
  createDeploymentRouter,
  estimateContextTokens,
} from "../src/domain/deployment-eligibility.js";
import type { ProviderAdapter } from "../src/domain/provider-adapter.js";
import { createGenerationRequest } from "../src/domain/provider-contracts.js";

function request(content: string, maxOutputTokens?: number) {
  return createGenerationRequest({
    messages: [{ role: "user", content }],
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
  });
}

function deployment(
  deploymentId: string,
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    deploymentId,
    adapterId: "mock",
    providerModelId: "model",
    capabilities: ["generation", "streaming"],
    contextWindowTokens: 100_000,
    prices: {
      currency: "USD",
      unit: "micros_per_million_tokens",
      input: 0,
      output: 0,
      cacheRead: 0,
    },
    enabled: true,
    ...overrides,
  };
}

function adapter(options: { stream?: boolean } = {}): ProviderAdapter {
  const base: ProviderAdapter = {
    async generate() {
      throw new Error("not invoked in eligibility tests");
    },
  };
  if (options.stream === false) return base;
  return {
    ...base,
    async *stream() {
      // Selection tests never iterate.
    },
  };
}

function router(
  deployments: readonly unknown[],
  adapters: ReadonlyMap<string, ProviderAdapter> = new Map([
    ["mock", adapter()],
  ]),
) {
  return createDeploymentRouter(
    createDeploymentCatalog({ deployments, adapters }),
  );
}

const generation = {
  capabilities: ["generation"],
  contextTokens: 100,
} as const;
const streaming = {
  capabilities: ["generation", "streaming"],
  contextTokens: 100,
} as const;

describe("estimateContextTokens", () => {
  test("counts content bytes, message framing, and the supplied output limit", () => {
    expect(estimateContextTokens(request("Hello", 100))).toBe(109);
  });

  test("uses UTF-8 byte length for multi-byte content", () => {
    expect(estimateContextTokens(request("é", 10))).toBe(16);
  });

  test("counts framing for every message", () => {
    const input = createGenerationRequest({
      messages: [
        { role: "system", content: "a" },
        { role: "user", content: "b" },
      ],
      maxOutputTokens: 10,
    });

    expect(estimateContextTokens(input)).toBe(20);
  });

  test("reserves 8192 output tokens when the limit is omitted", () => {
    expect(estimateContextTokens(request("Hello"))).toBe(8_201);
  });
});

describe("createDeploymentRouter", () => {
  test("selects the first eligible deployment in catalog order", () => {
    const selected = router([deployment("first"), deployment("second")]).select(
      generation,
    );

    expect(selected?.deployment.deploymentId).toBe("first");
    expect(selected?.adapter).toBeDefined();
  });

  test("skips a disabled deployment", () => {
    const selected = router([
      deployment("disabled", { enabled: false }),
      deployment("enabled"),
    ]).select(generation);

    expect(selected?.deployment.deploymentId).toBe("enabled");
  });

  test("requires the declared streaming capability", () => {
    expect(
      router([
        deployment("text-only", { capabilities: ["generation"] }),
      ]).select(streaming),
    ).toBeUndefined();
  });

  test("requires the adapter streaming operation", () => {
    expect(
      router(
        [deployment("declared")],
        new Map([["mock", adapter({ stream: false })]]),
      ).select(streaming),
    ).toBeUndefined();
  });

  test("requires the generation capability", () => {
    expect(
      router([
        deployment("no-generation", { capabilities: ["streaming"] }),
      ]).select(generation),
    ).toBeUndefined();
  });

  test("accepts the exact context boundary", () => {
    const input = request("Hello", 100);
    const selected = router([
      deployment("exact", {
        contextWindowTokens: estimateContextTokens(input),
      }),
    ]).select({
      capabilities: ["generation"],
      contextTokens: estimateContextTokens(input),
    });

    expect(selected?.deployment.deploymentId).toBe("exact");
  });

  test("rejects one token over the context boundary", () => {
    const estimate = estimateContextTokens(request("Hello", 100));
    expect(
      router([
        deployment("too-small", { contextWindowTokens: estimate - 1 }),
      ]).select({ capabilities: ["generation"], contextTokens: estimate }),
    ).toBeUndefined();
  });

  test("reserves 8192 tokens when the output limit is omitted", () => {
    const estimate = estimateContextTokens(request("Hello"));

    expect(
      router([deployment("exact", { contextWindowTokens: estimate })]).select({
        capabilities: ["generation"],
        contextTokens: estimate,
      })?.deployment.deploymentId,
    ).toBe("exact");
    expect(
      router([
        deployment("too-small", { contextWindowTokens: estimate - 1 }),
      ]).select({ capabilities: ["generation"], contextTokens: estimate }),
    ).toBeUndefined();
  });

  test("reports no eligible deployment", () => {
    expect(
      router([
        deployment("disabled", { enabled: false }),
        deployment("small", { contextWindowTokens: 1 }),
      ]).select(generation),
    ).toBeUndefined();
  });
});
