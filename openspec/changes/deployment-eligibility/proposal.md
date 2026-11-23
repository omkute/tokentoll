# Proposal

## Why

The M3–M4 proxy always invokes one hardcoded mock deployment and never checks whether that deployment can serve the request. M5 starts by making deployment choice explicit: a catalog of candidate deployments is filtered by capability, context fit, and operator enablement before any adapter work begins, so an ineligible target can never be invoked. Cost-aware ranking, retries, fallback, and circuit breaking remain later M5 changes.

## What Changes

- **BREAKING** for internal deployment-descriptor constructors: add a required boolean `enabled` fact to every model deployment. Disabled deployments are never eligible.
- Add an in-process deployment catalog that holds candidate deployments for the single `mock-chat` alias, requires unique deployment identifiers, and validates at startup that every `adapterId` resolves to a registered adapter.
- Add a pure eligibility evaluation over explicit facts:
  - required capability `generation`, plus `streaming` when the request selects SSE;
  - a declared capability counts only when the owning adapter also exposes the operation;
  - `enabled` is true;
  - the deployment context window fits a conservative context estimate.
- Define the context estimate as the sum of message UTF-8 byte lengths, four tokens per message, and the supplied output limit, or 8192 tokens when the request omits one. Byte length is an upper bound on content tokens, and 8192 is the maximum streamed or non-streamed content bound, so the estimate errs toward exclusion rather than overflow.
- Select the first eligible deployment in explicit catalog order. Catalog order is the operator's deterministic preference until cost-aware routing is approved.
- Return HTTP 503 `deployment_unavailable` with type `server_error` when the model is known but no deployment is eligible, before admission and without adapter invocation. Unknown model aliases keep returning 404 `model_not_found`.
- Wire the HTTP boundary to evaluate eligibility from the parsed request and invoke only the selected deployment's adapter.
- Update the default mock deployment to declare `generation` and `streaming` capabilities, raise its context window so every currently accepted request remains eligible, and preserve the existing `Mock response.` behavior.
- Exclude cost comparison and ranking, retries, fallback, circuit breaking, health probes, readiness signals, tenant/key policy, governance, credentials, live providers, persistence, caching, telemetry, and benchmarks.

## Capabilities

### New Capabilities

- `deployment-eligibility`: catalog construction, eligibility facts, deterministic eligible selection, and the no-eligible outcome for a known model.

### Modified Capabilities

- `model-deployments`: add the explicit operator `enabled` fact to the unified descriptor.
- `openai-chat-completions`: evaluate eligibility before invocation, select an eligible deployment instead of a fixed one, and classify `deployment_unavailable`.

## Impact

- Code: `src/domain/model-deployment.ts`, a new catalog/eligibility module under `src/domain/`, `src/http/chat-completions.ts`, `src/http/proxy-errors.ts`, `src/app.ts`, `src/mock-chat.ts`, tests, `README.md`.
- API: same endpoint and request/response shapes; new 503 `deployment_unavailable` outcome for a known model with no eligible target.
- Dependencies: none; the catalog is in-process and compile-time configured, with no persistence or network path.
- Requirements: FR-007 eligibility subset, ARC-001, NFR-001, TEST-001; FR-008 stays out of scope until the resilience change. No throughput or latency claim is made.
