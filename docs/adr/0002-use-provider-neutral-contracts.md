---
status: accepted
---

# ADR-0002: Use provider-neutral contracts

Gateway contracts remain provider-neutral and explicit provider adapters own translation and error normalization. This prevents provider SDKs and behavior from defining the gateway interface while preserving a dedicated place for unavoidable provider differences, as required by FR-001 and FR-004.

## Consequences

Adapters carry translation cost and normalized contracts may expose only the provider capabilities deliberately accepted by a specification.
