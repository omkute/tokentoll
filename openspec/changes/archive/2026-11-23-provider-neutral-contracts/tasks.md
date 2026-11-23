# Tasks

## 1. Provider-Neutral Domain Contracts

- [x] 1.1 Add a structured domain-validation error that reports invalid field paths without serializing submitted values, then verify focused Bun tests cover one and multiple invalid paths plus diagnostic secrecy.
- [x] 1.2 Implement immutable normalized message and generation-request construction in `src/domain/provider-contracts.ts`, then verify table-driven tests cover valid requests, empty messages, unsupported roles, blank content, output-token boundaries, provider-specific extra fields, and nested immutability.
- [x] 1.3 Implement normalized generation-response, finish-reason, and usage construction, then verify focused tests cover valid responses plus missing, negative, and fractional input/output/cache-read token counts.
- [x] 1.4 Implement the closed normalized provider-error taxonomy with explicit retryability and safe messages, then verify tests cover every category, non-retryable invalid input, and omission of causes, credentials, prompts, completions, and raw payloads.
- [x] 1.5 Implement the transport-independent content-delta, usage, and completion stream-event vocabulary, then verify focused tests accept each neutral variant and reject mismatched fields and provider-specific event shapes.

## 2. Unified Model Deployments

- [x] 2.1 Implement immutable model-deployment identity, capability, and context-limit construction in `src/domain/model-deployment.ts`, then verify tests cover distinct deployment identities, blank identifiers, explicit capability facts, provider-specific extra fields, integer context boundaries, and nested immutability.
- [x] 2.2 Add consistent currency and integer micro-unit price fields for input, output, and cache-read tokens, then verify tests cover zero and positive rates plus missing, negative, fractional, and provider-specific price representations.

## 3. Adapter Seam and Deterministic Mock

- [x] 3.1 Define the one-operation `ProviderAdapter` interface and neutral invocation value, then verify a compile-time fixture and focused test exercise the seam without importing a provider SDK or exposing provider-specific overloads.
- [x] 3.2 Implement validated discriminated mock configuration and deterministic success behavior, then verify repeated calls return the same normalized response and incomplete configurations fail during construction.
- [x] 3.3 Implement deterministic retryable/non-retryable provider-error and timeout outcomes plus invalid-input precedence, then verify focused offline tests assert exact neutral failures, no timers/network/credentials, and no configured outcome runs for invalid input.
- [x] 3.4 Add a reusable provider-adapter contract suite and run it against the deterministic mock, covering success normalization, invalid request handling, error classification, timeout semantics, sensitive-data exclusion, and immutable outputs.

## 4. Integrated Verification

- [x] 4.1 Run `bun run check` and `openspec validate provider-neutral-contracts --strict`, review the implementation against FR-001, FR-004, ARC-001, NFR-004, TEST-001, TEST-002, sensitive logging, immutability, and excluded M3+ scope, then resolve and report all findings without making performance claims.

## Workflow follow-up

- Review the completed implementation and its verification evidence before accepting the change.
- Archive the change only after implementation and review are approved.
