# Requirements

This document organizes the authoritative input in `requirements.txt`. Priorities use **Must** for mandated behavior and **Objective** for targets that require evidence. Milestones refer to [the roadmap](roadmap.md).

## Foundation and Gateway Capabilities

| ID | Requirement | Priority / milestone | Acceptance criteria and constraints |
|---|---|---|---|
| FR-001 | Expose a consistent, provider-neutral AI gateway interface over multiple LLM providers. | Must / evolving across M2–M5 | Gateway contracts contain no provider-specific request, response, or error types; provider behavior is isolated behind adapters. |
| FR-002 | Provide a deployable Node.js and TypeScript Fastify foundation. | Must / M1 | A production build starts and stops cleanly; startup configuration is environment-based; the process exposes a probe-suitable liveness/health endpoint. |
| FR-003 | Establish automated quality checks. | Must / M1 | Bun commands run formatting, linting, type checking, tests, and production-build verification; failures return non-zero status. |
| FR-004 | Define provider-neutral request/response contracts and deterministic mock providers. | Must / M2 | Contract tests prove successful normalization and representative invalid/upstream error cases without live-provider access. |
| FR-005 | Provide an OpenAI-compatible non-streaming proxy. | Must / M3 | The approved OpenAI-compatible subset accepts, validates, forwards through an adapter, and normalizes success and error responses. The exact subset requires a change specification. |
| FR-006 | Support SSE streaming. | Must / M4 | Tests prove incremental delivery, backpressure, client and upstream abort handling, partial usage handling, and socket/resource cleanup. |
| FR-007 | Route requests across eligible model deployments. | Must / M5 | Eligibility considers capabilities, context limits, tenant/key policy, governance, credentials, availability, health, and circuit state before selection. |
| FR-008 | Provide bounded resilience behavior. | Must / M5 | Configured timeouts, bounded retries, fallback, and circuit breaking are tested; retry exhaustion is normalized and fallback does not duplicate non-idempotent work. |

## Tenancy, Security, and Governance

| ID | Requirement | Priority / milestone | Acceptance criteria and constraints |
|---|---|---|---|
| FR-009 | Support tenant identity, teams, RBAC, virtual keys, and provider credentials. | Must / M6 | Authorized and denied paths are tested; every data access derives tenant scope from trusted identity rather than a client-supplied tenant identifier. |
| SEC-001 | Keep sensitive request and credential material out of logs by default. | Must / all applicable milestones | Tests or log inspection show prompts, completions, credentials, authorization headers, and other sensitive payloads are absent unless a separately approved policy permits them. |
| SEC-002 | Protect stored secrets. | Must / M6 | Only cryptographic hashes of virtual keys are stored; provider credentials use authenticated encryption; plaintext secrets do not appear in persistence or logs. |
| SEC-003 | Enforce tenant isolation at every data boundary. | Must / M6 onward | Cross-tenant read/write tests fail closed, including attempts to supply another tenant's identifier. |
| FR-010 | Apply PII protection, prompt-injection checks, and output scrubbing. | Must / M9 | Each approved guardrail has specified detection/enforcement behavior, fail-open/fail-closed policy, and positive/negative tests. Exact mechanisms remain undecided. |

## Accounting, Limits, and Observability

| ID | Requirement | Priority / milestone | Acceptance criteria and constraints |
|---|---|---|---|
| FR-011 | Account for input, output, and cache tokens using configured prices. | Must / M7 | Usage is attributed to the correct tenant, key, request, and deployment; price calculations cover all configured token categories and rounding rules specified by the change. |
| FR-012 | Enforce budgets and expose usage/reporting inputs. | Must / M7 | Approved budget boundaries have deterministic allow/deny behavior and reconciliation tests. |
| FR-013 | Emit usage and audit telemetry asynchronously. | Must / M7 | Request completion does not synchronously wait for telemetry persistence; the design specifies bounded buffering, failure handling, and shutdown draining. |
| FR-014 | Provide Redis-backed rate limiting, concurrency bounds, and controlled caching. | Must / M8 | Limit and cache behavior is tenant-aware and bounded; concurrency cannot grow without limit; cache keys and lifetimes prevent tenant leakage. Redis is excluded before M8. |

## Model Catalog and Routing Policy

| ID | Requirement | Priority / milestone | Acceptance criteria and constraints |
|---|---|---|---|
| ARC-001 | Represent every routable provider/model target as one model deployment entity in a unified catalog. | Must / M2 onward | Origin, nationality, market position, and labels such as frontier or cost-efficient do not create separate entity types, modules, specifications, or routing branches. |
| ARC-002 | Compare eligible deployments using consistent configured token prices for cost-aware routing. | Must / M5 | Input, output, and cache-token rates use the same comparison model for every deployment; non-cost preferences are explicit operator policy. |
| ARC-003 | Separate latency-sensitive data-plane work from administrative control-plane work. | Must / all milestones | Administrative operations and synchronous telemetry persistence do not run on the request hot path. |

## Reliability, Concurrency, and Resource Lifecycle

| ID | Requirement | Priority / milestone | Acceptance criteria and constraints |
|---|---|---|---|
| NFR-001 | Bound all workload-amplifying resources. | Must / all applicable milestones | Queues, concurrency, retries, request bodies, response buffers, and cache lifetimes have explicit finite limits and boundary tests. |
| NFR-002 | Propagate deadlines and cancellation end to end. | Must / M4 onward | Client abort or deadline cancels upstream work and releases timers, sockets, buffers, and accounting state within specified bounds. |
| NFR-003 | Shut down gracefully. | Must / M1 onward | Shutdown stops acceptance and closes listeners, upstream connections, timers, pools, and background workers without orphaned work. |
| NFR-004 | Contain unreliable provider behavior. | Must / M2 onward | Provider errors are normalized, retryability is classified, retries are bounded, and tests demonstrate prevention of retry storms. |
| NFR-005 | Keep memory bounded under adverse conditions. | Must / M4 onward | Load tests show no unbounded growth during concurrency, streaming, retries, cache misses, provider failure, or client disconnects. |

## Performance and Evidence

| ID | Requirement | Priority / milestone | Acceptance criteria and constraints |
|---|---|---|---|
| PERF-001 | Sustain 5,000 RPS in a controlled mock-provider benchmark. | Objective / M10 | A reproducible run reaches 5,000 RPS at the stated error threshold; until then, status remains **unverified**. |
| PERF-002 | Keep steady-state p95 gateway overhead below 5 ms. | Objective / M10 | A defined benchmark isolates gateway overhead and reports p95 below 5 ms; until then, status remains **unverified**. |
| PERF-003 | Make every performance claim reproducible. | Must / performance-sensitive changes | Record hardware/runtime, payload sizes, concurrency, duration, mock latency/failures, inclusion of upstream latency, throughput, p50/p95/p99, error rate, CPU, memory, and event-loop lag. |

## Testing and Development Process

| ID | Requirement | Priority / milestone | Acceptance criteria and constraints |
|---|---|---|---|
| TEST-001 | Use the narrowest test that proves behavior, then add integration coverage at module boundaries. | Must / all milestones | Applicable success, invalid input, timeout, cancellation, upstream failure, retry exhaustion, isolation, secrecy, and cleanup cases are covered. |
| TEST-002 | Prefer deterministic mock providers before live integrations. | Must / M2 onward | Core provider behavior and benchmarks run without external provider availability or credentials. |
| PROC-001 | Develop one bounded, approved task at a time through OpenSpec. | Must / all changes | Each implementation maps to an approved change and task; later roadmap capabilities remain excluded unless the change explicitly adds them. |
| PROC-002 | Require explicit permission for state-changing engineering work. | Must / all changes | Application code, dependency installation, infrastructure, commits, deployment, and OpenSpec initialization occur only after explicit approval. |
| PROC-003 | Report evidence honestly. | Must / all changes | Reports list commands and actual outcomes; no test, benchmark, or target is described as successful without recorded evidence. |

## Unresolved Decisions

The requirements do not yet approve the persistence architecture, deployment platform, telemetry transport, authentication mechanism, RBAC roles, exact OpenAI-compatible API surface, routing tie-breakers, cache semantics, or benchmark harness. PostgreSQL is explicitly excluded from M1 but is not otherwise mandated. Resolve each decision in the smallest OpenSpec change that needs it.
