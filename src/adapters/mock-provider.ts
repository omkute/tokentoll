import type {
  ProviderAdapter,
  ProviderInvocation,
} from "../domain/provider-adapter.js";
import type { NormalizedStreamEvent } from "../domain/provider-contracts.js";
import { createModelDeployment } from "../domain/model-deployment.js";
import {
  createGenerationRequest,
  createGenerationResponse,
  createStreamEvent,
  NormalizedProviderError,
} from "../domain/provider-contracts.js";
import { DomainValidationError } from "../domain/validation.js";

function assertValidInvocation(invocation: ProviderInvocation): void {
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
}

function splitSuccessContent(content: string): readonly string[] {
  if (content.length === 0) {
    return [];
  }
  const lastUsableIndex = Math.min(
    Math.floor(content.length / 2),
    content.length - 2,
  );
  const splitIndex =
    lastUsableIndex >= 0 ? content.lastIndexOf(" ", lastUsableIndex) : -1;
  if (splitIndex < 0) {
    return [content];
  }
  return [content.slice(0, splitIndex + 1), content.slice(splitIndex + 1)];
}

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
      assertValidInvocation(invocation);
      if (failure !== undefined) throw failure;
      if (response === undefined)
        throw new Error("Mock configuration invariant violated");
      return response;
    },
    async *stream(invocation) {
      assertValidInvocation(invocation);
      if (failure !== undefined) throw failure;
      if (response === undefined)
        throw new Error("Mock configuration invariant violated");
      const events: readonly NormalizedStreamEvent[] = [
        ...splitSuccessContent(response.content).map((delta) =>
          createStreamEvent({ type: "content_delta", delta }),
        ),
        createStreamEvent({ type: "usage", usage: response.usage }),
        createStreamEvent({
          type: "completed",
          finishReason: response.finishReason,
        }),
      ];
      for (const event of events) {
        if (invocation.signal?.aborted) return;
        yield event;
      }
    },
  } satisfies ProviderAdapter);
}
