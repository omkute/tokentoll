---
status: accepted
---

# ADR-0004: Keep telemetry off the request path

Usage and audit telemetry leaves the data plane asynchronously rather than through synchronous persistence on the request path. This protects request latency while retaining accounting and audit inputs, as required by FR-013 and ARC-003.

## Consequences

The eventual design must bound buffering and define overload, delivery, reconciliation, and shutdown-drain behavior. No transport or delivery guarantee is selected yet.
