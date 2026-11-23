# Design

## Context

The repository has a strict TypeScript/Fastify foundation but no provider-facing domain modules. See [proposal.md](proposal.md) for motivation and [specs](specs/) for behavior. Accepted ADRs require provider-neutral contracts, provider translation behind adapters, and one unified model-deployment entity. M2 must remain testable without provider SDKs, credentials, network access, persistence, proxy routes, or routing policy.

## Goals / Non-Goals

**Goals:**

- Establish a small, durable adapter seam whose interface contains only validated neutral values.
- Concentrate runtime validation and invariants in deep domain modules rather than spreading checks across callers.
- Make invalid input, normalized failure, timeout simulation, and successful usage accounting deterministic.
- Give future adapters a reusable contract-test surface.

**Non-Goals:**

- Define an OpenAI-compatible HTTP schema or add a generation route.
- Implement streaming transport, cancellation propagation, routing, retries, fallback, circuits, or live providers.
- Add tenant policy, credentials, persistence, telemetry, caching, or performance benchmarks.

## Decisions

### Use validated immutable domain values

Add focused domain modules under `src/domain/` for provider contracts and model deployments. Export read-only neutral value types plus construction/parsing functions that accept `unknown`, validate the complete value, and return frozen values. Validation failures are structured and identify invalid field paths without serializing whole requests, responses, credentials, or provider payloads.

Plain TypeScript interfaces alone were rejected because they disappear at runtime and cannot protect adapter inputs or configured mock outputs. A schema dependency was rejected because the M2 value set is small and the foundation already favors explicit validation; the decision can be revisited if later contracts become deeply nested.

### Keep the adapter seam to one operation

Define a `ProviderAdapter` module interface with one asynchronous `generate(invocation)` operation. The invocation contains a normalized request and unified model deployment; the result is a normalized response, and failures cross the seam as normalized provider errors. A single invocation object leaves room for later deadline/cancellation context without multiplying method parameters.

The stream-event vocabulary remains a domain type only. A streaming adapter method is deferred until M4 specifies ordering, backpressure, cancellation, and partial-usage semantics. Provider-specific overloads or optional escape-hatch payloads were rejected because they would move provider coupling into callers.

### Normalize errors at the adapter seam

Use a neutral error module with stable categories such as `invalid_request`, `timeout`, `rate_limited`, `provider_unavailable`, and `provider_error`, plus an explicit `retryable` boolean and safe message. Invalid normalized input is always non-retryable. The interface carries no raw cause or provider payload; adapter implementations may retain internal causes only if they never cross the seam or enter logs.

Inferring retryability later from messages or provider status codes was rejected because it spreads provider knowledge into routing and resilience modules.

### Represent every target with one deployment contract

Define one `ModelDeployment` value with deployment, adapter, and provider-model identifiers; explicit neutral capabilities; a positive context-token limit; and consistent price fields. Prices use a three-letter currency plus non-negative integer micro-units per one million input, output, and cache-read tokens. Fixed integer units avoid floating-point ambiguity and keep later comparisons uniform.

Provider-specific deployment subtypes and fields inferred from names were rejected because they violate the unified catalog decision and create routing branches based on provider identity.

### Make the mock adapter a configured deterministic state machine

Construct the mock adapter from a discriminated configuration with exactly one outcome: normalized success, normalized provider error, or normalized timeout. Construction validates and freezes the configured outcome. Invocation validates the request and deployment first; only then does it return or throw the configured outcome. Timeout simulation rejects immediately with the configured neutral timeout error, avoiding clocks, sleeps, network access, and flaky timing.

A callback-based arbitrary mock was rejected because it could bypass contract invariants and make results non-repeatable. A delayed timeout simulation was rejected because M2 tests need the semantic outcome, not wall-clock behavior; real deadline and cancellation mechanics belong to M4.

### Reuse one adapter contract suite

Create a contract-test helper that exercises any `ProviderAdapter` supplied by a test factory. The deterministic mock is its first adapter. Focused domain tests cover every validation boundary, while adapter contract tests cover successful normalization, invalid input precedence, retryable and non-retryable failures, timeout normalization, and absence of network or credential requirements.

Duplicating the same behavioral assertions in each future adapter test was rejected because drift would make the seam unreliable.

## Risks / Trade-offs

- [Hand-written validators can drift from their TypeScript types] → Keep types and constructors in the same domain module and drive every boundary through table-based tests.
- [Freezing only the outer value can leave nested arrays mutable] → Copy and freeze nested message, capability, and event collections during construction.
- [A mock can satisfy itself while real adapters interpret contracts differently] → Make the reusable contract suite the interface test surface for every future adapter.
- [The initial error taxonomy may need extension] → Use a closed M2 category set and require later additions through a spec change rather than accepting arbitrary provider codes.
- [Fixed price units may be unfamiliar] → Encode currency and unit semantics in field names/types and test zero, boundary, and invalid values.
- [Stream-event types could get ahead of transport semantics] → Limit M2 to the neutral vocabulary and add no streaming adapter operation or ordering guarantees beyond individual event validity.

## Migration Plan

This is an additive internal domain seam with no public generation endpoint or stored data. Implement neutral values and validators first, then the adapter interface, unified deployment descriptor, mock adapter, and reusable contract tests. Rollback removes those modules and tests without changing the existing health service or runtime configuration.
