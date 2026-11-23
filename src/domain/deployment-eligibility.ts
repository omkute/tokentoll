import type { DeploymentCatalog } from "./deployment-catalog.js";
import type { ModelCapability, ModelDeployment } from "./model-deployment.js";
import type { NormalizedGenerationRequest } from "./provider-contracts.js";
import type { ProviderAdapter } from "./provider-adapter.js";

const DEFAULT_OUTPUT_TOKEN_ALLOWANCE = 8192;
const MESSAGE_FRAMING_TOKENS = 4;

/**
 * Conservative context-window requirement for one request.
 *
 * A token encodes at least one UTF-8 byte for accepted text, so content byte
 * length is an upper bound on content tokens. The per-message allowance covers
 * role and delimiter framing. An omitted output limit reserves the endpoint's
 * 8192-byte maximum content bound as a safe token allowance.
 */
export function estimateContextTokens(
  request: NormalizedGenerationRequest,
): number {
  let estimate = request.maxOutputTokens ?? DEFAULT_OUTPUT_TOKEN_ALLOWANCE;
  for (const message of request.messages) {
    estimate +=
      Buffer.byteLength(message.content, "utf8") + MESSAGE_FRAMING_TOKENS;
  }
  return estimate;
}

export interface DeploymentRequirements {
  readonly capabilities: readonly ModelCapability[];
  readonly contextTokens: number;
}

export interface SelectedDeployment {
  readonly deployment: ModelDeployment;
  readonly adapter: ProviderAdapter;
}

export interface DeploymentRouter {
  select(requirements: DeploymentRequirements): SelectedDeployment | undefined;
}

function supportsOperation(
  adapter: ProviderAdapter,
  capability: ModelCapability,
): boolean {
  return capability === "generation"
    ? typeof adapter.generate === "function"
    : typeof adapter.stream === "function";
}

export function createDeploymentRouter(
  catalog: DeploymentCatalog,
): DeploymentRouter {
  return Object.freeze<DeploymentRouter>({
    select({ capabilities, contextTokens }: DeploymentRequirements) {
      for (const deployment of catalog.deployments) {
        if (!deployment.enabled) continue;
        if (deployment.contextWindowTokens < contextTokens) continue;
        if (
          !capabilities.every((capability) =>
            deployment.capabilities.includes(capability),
          )
        ) {
          continue;
        }

        const adapter = catalog.adapters.get(deployment.adapterId);
        if (adapter === undefined) continue;
        if (
          !capabilities.every((capability) =>
            supportsOperation(adapter, capability),
          )
        ) {
          continue;
        }

        return Object.freeze({ deployment, adapter });
      }
      return undefined;
    },
  });
}
