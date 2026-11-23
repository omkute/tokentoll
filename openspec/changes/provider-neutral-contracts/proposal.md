# Proposal

## Why

tokenToll needs a stable provider boundary before it can expose proxy APIs or integrate live providers. Defining neutral contracts and proving them with deterministic mocks makes provider behavior testable without network access, credentials, or provider SDK coupling.

## What Changes

- Add immutable normalized request, response, usage, stream-event, and error contracts with explicit validation boundaries.
- Add a provider-adapter interface that accepts only neutral types and classifies failures consistently.
- Add one unified model-deployment descriptor for every provider/model target, including identity, capabilities, context limit, and configured token prices.
- Add deterministic mock-provider behaviors for success, invalid input, normalized provider failure, and timeout simulation.
- Add contract and boundary tests that require no live provider, credentials, persistence, routing, or HTTP proxy endpoint.
- Keep OpenAI compatibility, live providers, deployment selection, retries/fallback, streaming transport, tenancy, persistence, and benchmarks out of scope.

## Capabilities

### New Capabilities

- `provider-neutral-contracts`: Normalized gateway request, response, usage, stream-event, error, and adapter contracts that contain no provider-specific types.
- `model-deployments`: A unified descriptor for provider/model targets and the capability, context, and pricing facts later routing stages consume.
- `deterministic-mock-provider`: Configurable provider-adapter behavior for deterministic success, validation failure, provider failure, and timeout simulation without external services.

### Modified Capabilities

None.

## Impact

This change adds TypeScript domain modules and focused tests behind the existing Fastify foundation. It implements FR-001, FR-004, ARC-001, NFR-004, TEST-001, and TEST-002 only for the M2 contract boundary; it adds no public HTTP proxy route, live-provider dependency, credentials, database, cache, retry engine, routing policy, telemetry pipeline, or performance claim.
