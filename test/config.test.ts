import { describe, expect, test } from "bun:test";

import {
  loadRuntimeConfig,
  RuntimeConfigError,
  type RuntimeEnvironment,
} from "../src/config.js";

function expectInvalid(
  environment: RuntimeEnvironment,
  invalidVariables: readonly string[],
): void {
  try {
    loadRuntimeConfig(environment);
    throw new Error("Expected runtime configuration to be rejected");
  } catch (error) {
    expect(error).toBeInstanceOf(RuntimeConfigError);
    expect((error as RuntimeConfigError).invalidVariables).toEqual(
      invalidVariables,
    );
  }
}

describe("loadRuntimeConfig", () => {
  test("uses defaults when supported variables are absent", () => {
    const config = loadRuntimeConfig({});

    expect(config).toEqual({
      host: "0.0.0.0",
      port: 3000,
      shutdownGraceMs: 10_000,
      requestTimeoutMs: 30_000,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  test("loads valid overrides", () => {
    expect(
      loadRuntimeConfig({
        HOST: "127.0.0.1",
        PORT: "8080",
        SHUTDOWN_GRACE_MS: "2500",
        REQUEST_TIMEOUT_MS: "45000",
      }),
    ).toEqual({
      host: "127.0.0.1",
      port: 8080,
      shutdownGraceMs: 2500,
      requestTimeoutMs: 45_000,
    });
  });

  test("trims supported values before validation", () => {
    expect(
      loadRuntimeConfig({
        HOST: "  localhost  ",
        PORT: " 3001 ",
        SHUTDOWN_GRACE_MS: " 5000\t",
        REQUEST_TIMEOUT_MS: " 20000\t",
      }),
    ).toEqual({
      host: "localhost",
      port: 3001,
      shutdownGraceMs: 5000,
      requestTimeoutMs: 20_000,
    });
  });

  test.each([
    ["PORT", "1", 1],
    ["PORT", "65535", 65_535],
    ["SHUTDOWN_GRACE_MS", "1", 1],
    ["SHUTDOWN_GRACE_MS", "60000", 60_000],
    ["REQUEST_TIMEOUT_MS", "1", 1],
    ["REQUEST_TIMEOUT_MS", "300000", 300_000],
  ] as const)("accepts the %s boundary %s", (variable, value, expected) => {
    const config = loadRuntimeConfig({ [variable]: value });
    const actual =
      variable === "PORT"
        ? config.port
        : variable === "SHUTDOWN_GRACE_MS"
          ? config.shutdownGraceMs
          : config.requestTimeoutMs;

    expect(actual).toBe(expected);
  });

  test.each([
    ["PORT", "0"],
    ["PORT", "65536"],
    ["SHUTDOWN_GRACE_MS", "0"],
    ["SHUTDOWN_GRACE_MS", "60001"],
    ["REQUEST_TIMEOUT_MS", "0"],
    ["REQUEST_TIMEOUT_MS", "300001"],
  ] as const)("rejects the %s out-of-range boundary %s", (variable, value) => {
    expectInvalid({ [variable]: value }, [variable]);
  });

  test.each([
    ["PORT", "not-a-number"],
    ["PORT", "1.5"],
    ["PORT", "-1"],
    ["PORT", "+1"],
    ["PORT", "1e3"],
    ["PORT", "0x10"],
    ["SHUTDOWN_GRACE_MS", "not-a-number"],
    ["SHUTDOWN_GRACE_MS", "1.5"],
    ["SHUTDOWN_GRACE_MS", "-1"],
    ["SHUTDOWN_GRACE_MS", "+1"],
    ["SHUTDOWN_GRACE_MS", "1e3"],
    ["SHUTDOWN_GRACE_MS", "0x10"],
    ["REQUEST_TIMEOUT_MS", "not-a-number"],
    ["REQUEST_TIMEOUT_MS", "1.5"],
    ["REQUEST_TIMEOUT_MS", "-1"],
    ["REQUEST_TIMEOUT_MS", "+1"],
    ["REQUEST_TIMEOUT_MS", "1e3"],
    ["REQUEST_TIMEOUT_MS", "0x10"],
    ["REQUEST_TIMEOUT_MS", ""],
  ] as const)(
    "rejects invalid integer syntax for %s: %s",
    (variable, value) => {
      expectInvalid({ [variable]: value }, [variable]);
    },
  );

  test.each(["", " ", "\t\n"])("rejects an empty host: %j", (host) => {
    expectInvalid({ HOST: host }, ["HOST"]);
  });

  test("reports multiple invalid supported variables together", () => {
    expectInvalid(
      {
        HOST: " ",
        PORT: "65536",
        SHUTDOWN_GRACE_MS: "1.5",
      },
      ["HOST", "PORT", "SHUTDOWN_GRACE_MS"],
    );
  });

  test("configuration diagnostics omit environment keys and values", () => {
    const unrelatedKey = "UNRELATED_SECRET";
    const unrelatedValue = "do-not-disclose";

    try {
      loadRuntimeConfig({
        PORT: "invalid-port-value",
        [unrelatedKey]: unrelatedValue,
      });
      throw new Error("Expected runtime configuration to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeConfigError);

      const configError = error as RuntimeConfigError;
      expect(configError.invalidVariables).toEqual(["PORT"]);
      expect(configError.message).toBe("Invalid runtime configuration: PORT");
      expect(configError.message).not.toContain("invalid-port-value");
      expect(configError.message).not.toContain(unrelatedKey);
      expect(configError.message).not.toContain(unrelatedValue);
    }
  });

  test("the structured invalid-variable list cannot be mutated", () => {
    try {
      loadRuntimeConfig({ PORT: "0" });
      throw new Error("Expected runtime configuration to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeConfigError);
      expect(
        Object.isFrozen((error as RuntimeConfigError).invalidVariables),
      ).toBe(true);
    }
  });
});
