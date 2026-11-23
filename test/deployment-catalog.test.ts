import { describe, expect, test } from "bun:test";

import { createDeploymentCatalog } from "../src/domain/deployment-catalog.js";
import type { ProviderAdapter } from "../src/domain/provider-adapter.js";
import { DomainValidationError } from "../src/domain/validation.js";

function adapter(): ProviderAdapter {
  return {
    async generate() {
      throw new Error("not invoked in catalog tests");
    },
  };
}

function deployment(
  deploymentId: string,
  adapterId = "mock",
  enabled = true,
): unknown {
  return {
    deploymentId,
    adapterId,
    providerModelId: "model",
    capabilities: ["generation"],
    contextWindowTokens: 8_192,
    prices: {
      currency: "USD",
      unit: "micros_per_million_tokens",
      input: 0,
      output: 0,
      cacheRead: 0,
    },
    enabled,
  };
}

function expectInvalid(input: unknown, invalidPaths: readonly string[]): void {
  try {
    createDeploymentCatalog(input);
    throw new Error("Expected catalog construction to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(DomainValidationError);
    expect((error as DomainValidationError).invalidPaths).toEqual(invalidPaths);
  }
}

describe("createDeploymentCatalog", () => {
  test("preserves deployment order and resolves adapters", () => {
    const catalog = createDeploymentCatalog({
      deployments: [deployment("first"), deployment("second")],
      adapters: new Map([["mock", adapter()]]),
    });

    expect(catalog.deployments.map((item) => item.deploymentId)).toEqual([
      "first",
      "second",
    ]);
    expect(catalog.adapters.get("mock")).toBeDefined();
  });

  test("rejects an empty catalog", () => {
    expectInvalid(
      { deployments: [], adapters: new Map([["mock", adapter()]]) },
      ["deployments"],
    );
  });

  test("rejects duplicate deployment identifiers", () => {
    expectInvalid(
      {
        deployments: [deployment("same"), deployment("same")],
        adapters: new Map([["mock", adapter()]]),
      },
      ["deployments[1].deploymentId"],
    );
  });

  test("rejects an unresolved adapter identifier", () => {
    expectInvalid(
      {
        deployments: [deployment("first", "missing")],
        adapters: new Map([["mock", adapter()]]),
      },
      ["deployments[0].adapterId"],
    );
  });

  test("prefixes invalid deployment paths", () => {
    expectInvalid(
      {
        deployments: [{ ...(deployment("first") as object), enabled: "yes" }],
        adapters: new Map([["mock", adapter()]]),
      },
      ["deployments[0].enabled"],
    );
  });

  test("rejects unknown catalog fields", () => {
    expectInvalid(
      {
        deployments: [deployment("first")],
        adapters: new Map([["mock", adapter()]]),
        fallback: true,
      },
      ["fallback"],
    );
  });
});
