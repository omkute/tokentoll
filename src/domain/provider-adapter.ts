import type { ModelDeployment } from "./model-deployment.js";
import type {
  NormalizedGenerationRequest,
  NormalizedGenerationResponse,
  NormalizedStreamEvent,
} from "./provider-contracts.js";

export interface ProviderInvocation {
  readonly request: NormalizedGenerationRequest;
  readonly deployment: ModelDeployment;
  readonly signal?: AbortSignal;
}

export interface ProviderAdapter {
  generate(
    invocation: ProviderInvocation,
  ): Promise<NormalizedGenerationResponse>;
  stream?(invocation: ProviderInvocation): AsyncIterable<NormalizedStreamEvent>;
}
