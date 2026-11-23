import { describe, expect, test } from "bun:test";

import { createModelDeployment } from "../src/domain/model-deployment.js";
import { DomainValidationError } from "../src/domain/validation.js";

function validDeployment(overrides: Record<string, unknown> = {}): unknown {
  return {
    deploymentId: "deployment-1",
    adapterId: "mock",
    providerModelId: "model-a",
    capabilities: ["generation"],
    contextWindowTokens: 8_192,
    prices: {
      currency: "USD",
      unit: "micros_per_million_tokens",
      input: 100,
      output: 200,
      cacheRead: 10,
    },
    ...overrides,
  };
}

function expectInvalidDeployment(
  input: unknown,
  invalidPaths: readonly string[],
): void {
  try {
    createModelDeployment(input);
    throw new Error("Expected deployment construction to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(DomainValidationError);
    expect((error as DomainValidationError).invalidPaths).toEqual(invalidPaths);
  }
}

describe("createModelDeployment", () => {
  test.each([0, 100, Number.MAX_SAFE_INTEGER])(
    "accepts fixed-unit price %s",
    (rate) => {
      const prices = {
        currency: "USD",
        unit: "micros_per_million_tokens",
        input: rate,
        output: rate,
        cacheRead: rate,
      };
      expect(createModelDeployment(validDeployment({ prices })).prices).toEqual(
        prices,
      );
    },
  );

  test.each(["input", "output", "cacheRead"] as const)(
    "validates every %s rate",
    (key) => {
      for (const value of [
        undefined,
        -1,
        0.5,
        Infinity,
        Number.MAX_SAFE_INTEGER + 1,
      ]) {
        expectInvalidDeployment(
          validDeployment({
            prices: {
              currency: "USD",
              unit: "micros_per_million_tokens",
              input: 0,
              output: 0,
              cacheRead: 0,
              [key]: value,
            },
          }),
          [`prices.${key}`],
        );
      }
    },
  );

  test("rejects currency, unit, and provider-specific prices", () => {
    expectInvalidDeployment(
      validDeployment({
        prices: {
          currency: "usd",
          unit: "tokens",
          input: 0,
          output: 0,
          cacheRead: 0,
          providerRate: 4,
        },
      }),
      ["prices.providerRate", "prices.currency", "prices.unit"],
    );
  });
  test("keeps deployments distinct when adapter and provider model match", () => {
    const first = createModelDeployment(validDeployment());
    const second = createModelDeployment(
      validDeployment({ deploymentId: "deployment-2" }),
    );

    expect(first.adapterId).toBe(second.adapterId);
    expect(first.providerModelId).toBe(second.providerModelId);
    expect(first.deploymentId).not.toBe(second.deploymentId);
  });

  test.each(["deploymentId", "adapterId", "providerModelId"] as const)(
    "rejects a blank %s",
    (field) => {
      expectInvalidDeployment(validDeployment({ [field]: "  " }), [field]);
    },
  );

  test("uses explicit neutral capabilities", () => {
    const deployment = createModelDeployment(
      validDeployment({ capabilities: ["generation", "streaming"] }),
    );

    expect(deployment.capabilities).toEqual(["generation", "streaming"]);
  });

  test.each([
    [[], ["capabilities"]],
    [["vision"], ["capabilities[0]"]],
    [["generation", "generation"], ["capabilities[1]"]],
  ] as const)(
    "rejects invalid capabilities: %j",
    (capabilities, invalidPaths) => {
      expectInvalidDeployment(validDeployment({ capabilities }), invalidPaths);
    },
  );

  test("rejects provider-specific deployment fields", () => {
    expectInvalidDeployment(
      validDeployment({ awsRegion: "us-east-1", openaiOrganization: "org" }),
      ["awsRegion", "openaiOrganization"],
    );
  });

  test.each([0, -1, 1.5, Number.POSITIVE_INFINITY])(
    "rejects invalid context windows: %s",
    (contextWindowTokens) => {
      expectInvalidDeployment(validDeployment({ contextWindowTokens }), [
        "contextWindowTokens",
      ]);
    },
  );

  test("accepts the positive context-window boundary", () => {
    expect(
      createModelDeployment(validDeployment({ contextWindowTokens: 1 }))
        .contextWindowTokens,
    ).toBe(1);
  });

  test("copies and freezes the deployment and capabilities", () => {
    const capabilities = ["generation"];
    const deployment = createModelDeployment(validDeployment({ capabilities }));

    capabilities.push("streaming");

    expect(deployment.capabilities).toEqual(["generation"]);
    expect(Object.isFrozen(deployment)).toBe(true);
    expect(Object.isFrozen(deployment.capabilities)).toBe(true);
    expect(Object.isFrozen(deployment.prices)).toBe(true);
  });
});
