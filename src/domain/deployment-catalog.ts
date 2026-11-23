import {
  createModelDeployment,
  type ModelDeployment,
} from "./model-deployment.js";
import type { ProviderAdapter } from "./provider-adapter.js";
import { DomainValidationError } from "./validation.js";

export interface DeploymentCatalog {
  readonly deployments: readonly ModelDeployment[];
  readonly adapters: ReadonlyMap<string, ProviderAdapter>;
}

const CATALOG_KEYS = new Set(["deployments", "adapters"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createDeploymentCatalog(input: unknown): DeploymentCatalog {
  if (!isRecord(input)) {
    throw new DomainValidationError(["catalog"]);
  }

  const invalidPaths: string[] = [];
  for (const key of Object.keys(input)) {
    if (!CATALOG_KEYS.has(key)) invalidPaths.push(key);
  }
  if (!Array.isArray(input.deployments) || input.deployments.length === 0) {
    invalidPaths.push("deployments");
  }
  if (!(input.adapters instanceof Map)) {
    invalidPaths.push("adapters");
  }
  if (invalidPaths.length > 0) {
    throw new DomainValidationError(invalidPaths);
  }

  const deployments: ModelDeployment[] = [];
  const deploymentIds = new Set<string>();
  (input.deployments as readonly unknown[]).forEach((candidate, index) => {
    let deployment: ModelDeployment;
    try {
      deployment = createModelDeployment(candidate);
    } catch (error) {
      if (error instanceof DomainValidationError) {
        throw new DomainValidationError(
          error.invalidPaths.map((path) => `deployments[${index}].${path}`),
        );
      }
      throw error;
    }
    if (deploymentIds.has(deployment.deploymentId)) {
      throw new DomainValidationError([`deployments[${index}].deploymentId`]);
    }
    deploymentIds.add(deployment.deploymentId);
    deployments.push(deployment);
  });

  const adapters = input.adapters as ReadonlyMap<string, ProviderAdapter>;
  deployments.forEach((deployment, index) => {
    if (adapters.get(deployment.adapterId) === undefined) {
      throw new DomainValidationError([`deployments[${index}].adapterId`]);
    }
  });

  return Object.freeze({
    deployments: Object.freeze(deployments),
    adapters: new Map(adapters),
  });
}
