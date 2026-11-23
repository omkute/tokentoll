# Requirements Traceability

This baseline maps every substantive section of `requirements.txt` to maintained documentation. Requirement IDs are defined in [requirements.md](requirements.md).

| Source section or statement | Requirement IDs | Primary documentation |
|---|---|---|
| Mission: multi-provider gateway centralizing routing, reliability, security, quotas, caching, accounting, and observability | FR-001, FR-007–FR-014 | [Vision](vision.md), [Architecture](architecture.md) |
| Controlled 5,000 RPS objective; evidence-only optimization | PERF-001, PERF-003, PROC-003 | [Vision](vision.md), [Roadmap M10](roadmap.md#m10--reproducible-benchmarks-and-optimization) |
| Human learning objective and incremental explanations | PROC-001 | [Vision](vision.md#learning-objectives), [AGENTS.md](../AGENTS.md) |
| Source inspection, scoped sources of truth, conflict reporting | PROC-001–PROC-003 | [Documentation authority](README.md#authority-and-scope), [AGENTS.md](../AGENTS.md) |
| Implemented foundation and quality loop | FR-002, FR-003 | [Roadmap M1](roadmap.md#m1--foundation-and-deployable-process), [service-lifecycle spec](../openspec/specs/service-lifecycle/spec.md) |
| Foundation exclusions: PostgreSQL, Redis, auth, providers, routing, streaming, caching, billing, guardrails | PROC-001 | [Roadmap M1](roadmap.md#m1--foundation-and-deployable-process) |
| Data-plane/control-plane separation | ARC-003 | [Architecture](architecture.md#operational-planes-and-components), [ADR-0001](adr/0001-separate-operational-planes.md) |
| Provider-neutral contracts and explicit adapters | FR-001, FR-004 | [Architecture](architecture.md#provider-neutral-interfaces), [ADR-0002](adr/0002-use-provider-neutral-contracts.md) |
| Unified model deployment entity; labels/origin are not classes | ARC-001 | [Architecture](architecture.md#unified-model-deployment-catalog), [ADR-0003](adr/0003-unify-model-deployments.md) |
| Eligibility dimensions and uniform cost comparison | FR-007, ARC-002 | [Requirements](requirements.md#model-catalog-and-routing-policy), [Roadmap M5](roadmap.md#m5--routing-and-provider-resilience) |
| Ten-stage capability order | PROC-001 and milestone-specific IDs | [Roadmap](roadmap.md) |
| Specification-driven lifecycle and approval gates | PROC-001, PROC-002 | [AGENTS.md](../AGENTS.md), [Documentation authority](README.md#authority-and-scope) |
| Small modules, stable interfaces, no premature abstraction | FR-001, PROC-001 | [Architecture](architecture.md#provider-neutral-interfaces), [AGENTS.md](../AGENTS.md) |
| Bounded queues, concurrency, retries, bodies, buffers, cache lifetimes | NFR-001, NFR-005 | [Architecture](architecture.md#reliability-and-resource-lifecycle) |
| Deadline and cancellation propagation | NFR-002 | [Roadmap M4](roadmap.md#m4--streaming-and-cancellation), [Architecture](architecture.md#request-lifecycle) |
| Graceful shutdown of all resource types | NFR-003 | [Roadmap M1](roadmap.md#m1--foundation-and-deployable-process), [Architecture](architecture.md#reliability-and-resource-lifecycle) |
| Provider failures, normalized errors, retryability, retry storms | NFR-004, FR-008 | [Roadmap M5](roadmap.md#m5--routing-and-provider-resilience) |
| Sensitive logging, virtual-key hashes, credential encryption | SEC-001, SEC-002 | [Requirements](requirements.md#tenancy-security-and-governance), [Architecture](architecture.md#tenant-isolation-and-security) |
| Trusted tenant identity at every data access boundary | SEC-003, FR-009 | [Architecture](architecture.md#tenant-isolation-and-security), [Roadmap M6](roadmap.md#m6--tenant-identity-and-credential-security) |
| Benchmark metadata and metrics | PERF-003 | [Requirements](requirements.md#performance-and-evidence), [Roadmap M10](roadmap.md#m10--reproducible-benchmarks-and-optimization) |
| p95 gateway overhead under 5 ms objective | PERF-002 | [Vision](vision.md#goals), [Architecture](architecture.md#performance-boundary) |
| Memory bounded under adverse conditions | NFR-005 | [Architecture](architecture.md#reliability-and-resource-lifecycle), [Roadmap M4](roadmap.md#m4--streaming-and-cancellation) |
| Narrow tests, integration boundaries, applicable failure/security/lifecycle cases | TEST-001 | [Requirements](requirements.md#testing-and-development-process), milestone verification in [Roadmap](roadmap.md) |
| Deterministic mocks before live providers | TEST-002 | [Roadmap M2](roadmap.md#m2--neutral-contracts-and-mock-providers), [Roadmap M10](roadmap.md#m10--reproducible-benchmarks-and-optimization) |
| Streaming test matrix | FR-006, NFR-002, NFR-005 | [Roadmap M4](roadmap.md#m4--streaming-and-cancellation) |
| Bounded retries and non-idempotent fallback safety | FR-008, NFR-004 | [Roadmap M5](roadmap.md#m5--routing-and-provider-resilience) |
| Formatting, linting, type checking, tests, build, spec validation, benchmarks | FR-003, TEST-001, PERF-003 | [Requirements](requirements.md#testing-and-development-process), milestone verification in [Roadmap](roadmap.md) |
| Collaboration protocol: inspect, scope, explain, approve, review, report | PROC-001–PROC-003 | [AGENTS.md](../AGENTS.md) |

## Review Result

- All source sections map to maintained documentation and stable requirements.
- The ten milestones retain their original order and explicit M1 exclusions.
- Security invariants apply when their data and capabilities exist; later guardrail features are not pulled into M1.
- Both performance targets are labeled unverified objectives throughout.
- Accepted constraints, deferred decisions, OpenSpec main specs, and change artifacts have distinct roles.
- As of 2026-11-23, M1–M3 are implemented, verified, and archived; accepted specifications live in `openspec/specs/`, and M4–M10 remain unimplemented.
