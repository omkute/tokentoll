# Architecture Decision Records

ADRs record architectural choices that are costly to reverse, non-obvious without context, and made after a real tradeoff. Requirements and routine implementation details belong elsewhere.

## Convention

- Use `NNNN-short-slug.md` with the next sequential number.
- Start from [the template](template.md).
- Use status `proposed`, `accepted`, `deprecated`, or `superseded by ADR-NNNN`.
- A proposed ADR is not permission to implement. Approval changes its status to accepted.
- Link the governing requirement and relevant OpenSpec change. Keep the decision and rationale concise; include alternatives or consequences only when they prevent future confusion.

## Decision Register

### Accepted constraints

- [ADR-0001: Separate operational planes](0001-separate-operational-planes.md)
- [ADR-0002: Use provider-neutral contracts](0002-use-provider-neutral-contracts.md)
- [ADR-0003: Unify model deployments](0003-unify-model-deployments.md)
- [ADR-0004: Keep telemetry off the request path](0004-keep-telemetry-off-request-path.md)

These decisions are explicitly mandated by `requirements.txt`; the ADRs record their rationale and consequences rather than inventing new choices.

### Proposed decisions requiring approval

None. Create a proposed ADR only when a bounded OpenSpec change reaches a qualifying decision.

### Deferred decisions

- Exact OpenAI-compatible endpoints and fields.
- Persistence ownership and technology, including whether PostgreSQL has a role.
- Deployment platform and topology.
- Authentication mechanism, RBAC roles, and key lifecycle details.
- Telemetry transport, storage, delivery guarantees, and reconciliation.
- Routing tie-breakers, retry/fallback idempotency, and circuit thresholds.
- Redis topology, rate-limit semantics, and cache safety/invalidation.
- Guardrail mechanisms and fail-open/fail-closed policies.
- Benchmark harness, scenarios, and acceptable error thresholds.

Deferred means intentionally undecided, not implicitly approved.
