import type { ModelDeployment } from "./model-deployment.js";
import type {
  NormalizedGenerationRequest,
  NormalizedGenerationResponse,
} from "./provider-contracts.js";

export interface ProviderInvocation {
  readonly request: NormalizedGenerationRequest;
  readonly deployment: ModelDeployment;
}

export interface ProviderAdapter {
  generate(
    invocation: ProviderInvocation,
  ): Promise<NormalizedGenerationResponse>;
}
