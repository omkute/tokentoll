---
status: accepted
---

# ADR-0003: Unify model deployments

Every routable provider/model target is represented by one model deployment entity. Provider origin, nationality, market position, and labels remain attributes rather than separate types or routing branches, keeping eligibility and cost comparison uniform as required by ARC-001 and ARC-002.

## Consequences

Provider-specific capabilities must be represented through the shared catalog model or adapter boundary; non-cost routing preferences require explicit operator policy.
