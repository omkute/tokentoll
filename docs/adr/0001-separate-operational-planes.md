---
status: accepted
---

# ADR-0001: Separate operational planes

tokenToll separates the latency-sensitive data plane from the administrative control plane. Control-plane operations and synchronous telemetry persistence stay off the request hot path so administrative work cannot silently become request latency; this is mandated by ARC-003 in `requirements.txt`.

## Consequences

Configuration must cross an explicit boundary into serving components, and eventual consistency may be necessary. The transport and persistence mechanisms remain undecided.
