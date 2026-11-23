import type { ProviderAdapter } from "../domain/provider-adapter.js";
import { createModelDeployment } from "../domain/model-deployment.js";
import {
  createGenerationRequest,
  createGenerationResponse,
  NormalizedProviderError,
} from "../domain/provider-contracts.js";
import { DomainValidationError } from "../domain/validation.js";

export function createMockProvider(configuration: unknown): ProviderAdapter {
  if (
    typeof configuration !== "object" ||
    configuration === null ||
    !("outcome" in configuration)
  ) {
    throw new DomainValidationError(["configuration"]);
  }
  const success = configuration.outcome === "success";
  if (
    configuration.outcome !== "success" &&
    configuration.outcome !== "provider_error" &&
    configuration.outcome !== "timeout"
  ) {
    throw new DomainValidationError(["configuration"]);
  }
  if (
    Object.keys(configuration).some(
      (key) => key !== "outcome" && key !== (success ? "response" : "error"),
    )
  ) {
    throw new DomainValidationError(["configuration"]);
  }
  const response = success
    ? createGenerationResponse(
        "response" in configuration ? configuration.response : undefined,
      )
    : undefined;
  const failure = success
    ? undefined
    : NormalizedProviderError.create(
        "error" in configuration ? configuration.error : undefined,
      );
  if (
    (configuration.outcome === "timeout" && failure?.category !== "timeout") ||
    (configuration.outcome === "provider_error" &&
      (failure?.category === "timeout" ||
        failure?.category === "invalid_request"))
  ) {
    throw new DomainValidationError(["configuration.error.category"]);
  }
  return Object.freeze({
    async generate(invocation) {
      try {
        createGenerationRequest(invocation.request);
        const deployment = createModelDeployment(invocation.deployment);
        if (
          deployment.adapterId !== "mock" ||
          !deployment.capabilities.includes("generation")
        ) {
          throw new DomainValidationError(["deployment"]);
        }
      } catch {
        throw NormalizedProviderError.create({
          category: "invalid_request",
          retryable: false,
          message: "Invalid provider invocation",
        });
      }
      if (failure !== undefined) throw failure;
      if (response === undefined)
        throw new Error("Mock configuration invariant violated");
      return response;
    },
  } satisfies ProviderAdapter);
}
