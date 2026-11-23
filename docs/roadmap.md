# Incremental Roadmap

Each milestone is a planning boundary, not authorization to implement. Use one or more small OpenSpec changes per milestone; complete and verify each bounded slice before advancing.

## Implementation Status

| Milestone | Status | Evidence |
| --- | --- | --- |
| M1 — Foundation and Deployable Process | Implemented and verified | Archived `2026-11-23-foundation`; specs `service-lifecycle`, `service-health`, `runtime-configuration`, `project-quality-checks` |
| M2 — Neutral Contracts and Mock Providers | Implemented and verified | Archived `2026-11-23-provider-neutral-contracts`; specs `provider-neutral-contracts`, `model-deployments`, `deterministic-mock-provider` |
| M3 — OpenAI-Compatible Non-Streaming Proxy | Implemented and verified | Archived `2026-11-23-openai-nonstreaming-proxy`; spec `openai-chat-completions` |
| M4–M10 | Not started | No approved change |

## M1 — Foundation and Deployable Process

- **Objective:** Establish the smallest runnable gateway process and quality loop.
- **Scope:** Node.js/TypeScript, Fastify entrypoint, environment configuration boundary, liveness/health probe, graceful process lifecycle, formatting, linting, type checking, tests, and production build. Use Bun for package management and tasks.
- **Exclusions:** PostgreSQL, Redis, authentication, provider integrations, routing, streaming, caching, billing, telemetry, and security guardrails.
- **Dependencies:** Approved foundation proposal; decisions limited to tooling needed by this slice.
- **Deliverables:** Runnable service, configuration validation, health route, shutdown handling, quality scripts, unit/integration tests.
- **Verification:** Clean install and all quality commands pass; valid configuration starts; invalid configuration fails clearly; health probe works; shutdown closes the listener.
- **Candidate OpenSpec changes:** `foundation-service`, optionally split into `foundation-quality-gates` if independently useful.

## M2 — Neutral Contracts and Mock Providers

- **Objective:** Prove the provider boundary without a live integration.
- **Scope:** Normalized request, response, usage, stream-event, and error concepts; adapter contract; model-deployment descriptor; deterministic mock providers.
- **Exclusions:** OpenAI compatibility, live providers, routing, retries/fallback, persistence, tenancy, and streaming transport.
- **Dependencies:** M1.
- **Deliverables:** Contract types, adapter seam, configurable mock behaviors, contract tests.
- **Verification:** Success, invalid input, provider error, timeout simulation, and normalization tests are deterministic and require no network or credentials.
- **Candidate OpenSpec changes:** `provider-neutral-contracts`, `deterministic-mock-provider`.

## M3 — OpenAI-Compatible Non-Streaming Proxy

- **Objective:** Deliver the first end-to-end request through the neutral adapter boundary.
- **Scope:** One explicitly specified OpenAI-compatible non-streaming endpoint/subset, validation, mock-provider forwarding, normalized response/errors, body limits.
- **Exclusions:** SSE, live providers, multi-deployment routing, authentication, quotas, caching, and billing.
- **Dependencies:** M2; approval of exact compatibility surface.
- **Deliverables:** HTTP boundary, translation to neutral contracts, mock adapter path, compatibility tests.
- **Verification:** Approved request/response fixtures pass; unsupported fields and invalid bodies fail predictably; provider details do not leak into gateway contracts.
- **Candidate OpenSpec changes:** `openai-nonstreaming-proxy`.

## M4 — Streaming and Cancellation

- **Objective:** Stream incrementally while keeping memory and resources bounded.
- **Scope:** SSE output, stream-event normalization, backpressure, deadline/cancellation propagation, client/upstream aborts, partial usage handling, cleanup.
- **Exclusions:** Multi-provider routing, retries/fallback, authentication, persistence, budgets, Redis, and caching.
- **Dependencies:** M3.
- **Deliverables:** Streaming boundary, abort propagation, bounded buffering, lifecycle tests.
- **Verification:** Tests prove incremental delivery, slow-consumer backpressure, both abort directions, timeout behavior, partial accounting semantics, and socket/timer cleanup.
- **Candidate OpenSpec changes:** `sse-streaming`, `stream-cancellation-lifecycle`.

## M5 — Routing and Provider Resilience

- **Objective:** Select among eligible deployments and contain provider failures.
- **Scope:** Eligibility filtering, cost-aware selection, timeouts, bounded retries, fallback, circuit breaking, health/circuit state, normalized retryability.
- **Exclusions:** Tenant authentication/RBAC, budgets, Redis, persistent control plane, PII guardrails, and production optimization.
- **Dependencies:** M2–M4; explicit idempotency and operator-policy decisions.
- **Deliverables:** Catalog-facing router, resilience policies, circuit state model, failure tests.
- **Verification:** Ineligible deployments are never selected; consistent rates drive cost comparison; preferences are explicit; retry storms are bounded; fallback avoids duplicate non-idempotent work.
- **Candidate OpenSpec changes:** `deployment-eligibility`, `cost-aware-routing`, `provider-resilience`.

## M6 — Tenant Identity and Credential Security

- **Objective:** Establish trusted tenant boundaries and administrative authorization.
- **Scope:** Tenant/team identity, RBAC, virtual keys, provider credential protection, trusted tenant context, isolation enforcement.
- **Exclusions:** Token pricing/budgets, Redis limits/cache, content guardrails, and full reporting.
- **Dependencies:** Earlier request boundaries; approved identity, role, persistence, and key-lifecycle designs.
- **Deliverables:** Authentication/authorization boundary, key lifecycle, credential encryption, tenant-scoped access paths, audit inputs.
- **Verification:** Allow/deny matrices pass; cross-tenant attempts fail closed; virtual keys are hashed; provider credentials use authenticated encryption; secrets and sensitive payloads are absent from logs.
- **Candidate OpenSpec changes:** `tenant-identity`, `rbac`, `virtual-key-lifecycle`, `provider-credential-protection`.

## M7 — Accounting, Pricing, Budgets, and Telemetry

- **Objective:** Attribute usage and enforce financial policy without synchronous telemetry writes on the hot path.
- **Scope:** Input/output/cache token accounting, configured prices, budget decisions, bounded asynchronous usage/audit events, reconciliation and reporting inputs.
- **Exclusions:** Redis rate limiting/cache, PII/prompt guardrails, and final performance optimization.
- **Dependencies:** M5 routing identity and M6 tenant/key identity; approved pricing, rounding, persistence, and event-delivery semantics.
- **Deliverables:** Usage model, pricing calculation, budget boundary, event pipeline, failure/reconciliation behavior.
- **Verification:** Usage is attributed to the correct request/tenant/key/deployment; price fixtures pass; budget edges are deterministic; telemetry failure cannot create an unbounded queue or block the request on synchronous persistence; shutdown behavior is tested.
- **Candidate OpenSpec changes:** `token-accounting`, `deployment-pricing`, `budget-enforcement`, `async-usage-telemetry`.

## M8 — Distributed Limits and Controlled Caching

- **Objective:** Bound shared traffic and reuse safe results across gateway instances.
- **Scope:** Redis-backed tenant-aware rate limits, concurrency limits, controlled caching, finite TTLs and buffers, failure policy.
- **Exclusions:** Content security guardrails and evidence-based optimization beyond validating this capability.
- **Dependencies:** M6 trusted tenant identity, M7 accounting/budget semantics, approved Redis topology and cache safety policy.
- **Deliverables:** Limiters, concurrency permits, cache keys/policy, Redis failure handling, isolation tests.
- **Verification:** Limit windows and concurrency caps are deterministic; limits remain bounded during Redis failure; cache entries cannot cross tenants; key composition, eligibility, invalidation, and TTL behavior match the specification.
- **Candidate OpenSpec changes:** `redis-rate-limiting`, `distributed-concurrency-limits`, `controlled-response-cache`.

## M9 — Content Security Guardrails

- **Objective:** Apply approved protections to sensitive and adversarial content.
- **Scope:** PII protection, prompt-injection checks, output scrubbing, policy configuration, explicit failure behavior, audit signals.
- **Exclusions:** Unspecified claims of complete detection and unrelated model moderation features.
- **Dependencies:** M6 policy/tenant boundaries and M7 telemetry; approval of detection mechanisms and fail-open/fail-closed behavior.
- **Deliverables:** Guardrail interfaces, enforcement points, policy outcomes, redaction/audit behavior, adversarial fixtures.
- **Verification:** Positive, negative, bypass, error, latency, secrecy, and tenant-policy tests pass; sensitive content does not leak through logs or audit data.
- **Candidate OpenSpec changes:** `pii-protection`, `prompt-injection-policy`, `output-scrubbing`.

## M10 — Reproducible Benchmarks and Optimization

- **Objective:** Measure the complete gateway and optimize only from evidence.
- **Scope:** Controlled mock-provider workloads, benchmark harness, documented environments, throughput/tail-latency/resource metrics, profiling, bounded evidence-driven changes.
- **Exclusions:** Declaring targets achieved without reproducible results; changing semantics solely to improve a headline number.
- **Dependencies:** Relevant earlier milestones and stable benchmark definitions.
- **Deliverables:** Versioned scenarios, runner, result format, baseline report, profiles, separately reviewed optimization changes.
- **Verification:** Reports include hardware/runtime, payload sizes, concurrency, duration, mock behavior, upstream-latency treatment, RPS, p50/p95/p99, errors, CPU, memory, and event-loop lag. Evaluate—but do not presume—the 5,000 RPS and p95-under-5-ms objectives.
- **Candidate OpenSpec changes:** `benchmark-harness`, followed by one measured optimization change per demonstrated bottleneck.
