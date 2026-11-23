import { DomainValidationError } from "./validation.js";

export type ModelCapability = "generation" | "streaming";

export interface TokenPrices {
  readonly currency: string;
  readonly unit: "micros_per_million_tokens";
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
}

export interface ModelDeployment {
  readonly deploymentId: string;
  readonly adapterId: string;
  readonly providerModelId: string;
  readonly capabilities: readonly ModelCapability[];
  readonly contextWindowTokens: number;
  readonly prices: TokenPrices;
  readonly enabled: boolean;
}

const DEPLOYMENT_KEYS = new Set([
  "deploymentId",
  "adapterId",
  "providerModelId",
  "capabilities",
  "contextWindowTokens",
  "prices",
  "enabled",
]);
const PRICE_KEYS = new Set([
  "currency",
  "unit",
  "input",
  "output",
  "cacheRead",
]);
const MODEL_CAPABILITIES = new Set<ModelCapability>([
  "generation",
  "streaming",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectExtraKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  prefix: string,
  invalidPaths: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      invalidPaths.push(prefix.length === 0 ? key : `${prefix}.${key}`);
    }
  }
}

function normalizeIdentifier(
  value: unknown,
  path: string,
  invalidPaths: string[],
): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalidPaths.push(path);
    return undefined;
  }
  return value.trim();
}

function createPrices(
  input: unknown,
  invalidPaths: string[],
): TokenPrices | undefined {
  if (!isRecord(input)) {
    invalidPaths.push("prices");
    return undefined;
  }

  collectExtraKeys(input, PRICE_KEYS, "prices", invalidPaths);
  const currency = input.currency;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    invalidPaths.push("prices.currency");
  }
  if (input.unit !== "micros_per_million_tokens") {
    invalidPaths.push("prices.unit");
  }

  const normalizedRates = { input: 0, output: 0, cacheRead: 0 };
  let validRates = true;
  for (const key of ["input", "output", "cacheRead"] as const) {
    const value = input[key];
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      invalidPaths.push(`prices.${key}`);
      validRates = false;
    } else {
      normalizedRates[key] = value;
    }
  }

  if (
    typeof currency !== "string" ||
    !/^[A-Z]{3}$/.test(currency) ||
    input.unit !== "micros_per_million_tokens" ||
    !validRates
  ) {
    return undefined;
  }

  return Object.freeze({
    currency,
    unit: "micros_per_million_tokens",
    ...normalizedRates,
  });
}

export function createModelDeployment(input: unknown): ModelDeployment {
  if (!isRecord(input)) {
    throw new DomainValidationError(["deployment"]);
  }

  const invalidPaths: string[] = [];
  collectExtraKeys(input, DEPLOYMENT_KEYS, "", invalidPaths);
  const deploymentId = normalizeIdentifier(
    input.deploymentId,
    "deploymentId",
    invalidPaths,
  );
  const adapterId = normalizeIdentifier(
    input.adapterId,
    "adapterId",
    invalidPaths,
  );
  const providerModelId = normalizeIdentifier(
    input.providerModelId,
    "providerModelId",
    invalidPaths,
  );

  const capabilities: ModelCapability[] = [];
  if (!Array.isArray(input.capabilities) || input.capabilities.length === 0) {
    invalidPaths.push("capabilities");
  } else {
    input.capabilities.forEach((capability, index) => {
      if (
        typeof capability !== "string" ||
        !MODEL_CAPABILITIES.has(capability as ModelCapability)
      ) {
        invalidPaths.push(`capabilities[${index}]`);
      } else if (!capabilities.includes(capability as ModelCapability)) {
        capabilities.push(capability as ModelCapability);
      } else {
        invalidPaths.push(`capabilities[${index}]`);
      }
    });
  }

  const contextWindowTokens = input.contextWindowTokens;
  if (
    typeof contextWindowTokens !== "number" ||
    !Number.isSafeInteger(contextWindowTokens) ||
    contextWindowTokens <= 0
  ) {
    invalidPaths.push("contextWindowTokens");
  }

  const enabled = input.enabled;
  if (typeof enabled !== "boolean") {
    invalidPaths.push("enabled");
  }

  const prices = createPrices(input.prices, invalidPaths);
  if (invalidPaths.length > 0) {
    throw new DomainValidationError(invalidPaths);
  }

  return Object.freeze({
    deploymentId: deploymentId as string,
    adapterId: adapterId as string,
    providerModelId: providerModelId as string,
    capabilities: Object.freeze(capabilities),
    contextWindowTokens: contextWindowTokens as number,
    prices: prices as TokenPrices,
    enabled: enabled as boolean,
  });
}
