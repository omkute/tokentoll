# tokenToll Glossary

Canonical terms for the tokenToll domain and the systems concepts required to understand it.

## Gateway and Domain

**AI gateway**: A service between clients and LLM providers that offers one entry point for provider access and shared policy.

_Avoid_: model server, inference engine

**Provider adapter**: A boundary that translates the gateway's neutral contracts to and from one provider's API and error behavior.

_Avoid_: provider-specific gateway

**Model deployment**: One routable provider/model target with configured capabilities, limits, credentials, health, governance, and token prices. It is the single catalog entity regardless of provider labels or origin.

_Avoid_: model class, provider tier

**Multi-tenancy**: Operation of one gateway for multiple isolated customer domains, with identity and policy enforced at every data boundary.

**Token accounting**: Measurement and attribution of input, output, and cache tokens to the correct request, tenant, deployment, and price.

## Operational Boundaries

**Data plane**: The latency-sensitive path that authenticates, enforces policy, selects a deployment, calls a provider, and returns or streams a response.

**Control plane**: Administrative capabilities for tenants, teams, keys, deployments, budgets, configuration, and reporting.

## Resilience and Flow Control

**Rate limiting**: Rejecting or delaying work to keep request volume within a configured allowance over time.

**Circuit breaker**: A stateful guard that temporarily stops calls to an unhealthy dependency and later probes whether it has recovered.

**Backpressure**: Flow control that prevents a fast producer from creating unbounded buffered data when a consumer is slower.

**Cancellation propagation**: Carrying a client abort, deadline, or internal cancellation through all downstream work so resources are released promptly.

## Performance

**RPS**: Requests completed or accepted per second during a stated workload. It is throughput, not the number of simultaneous requests.

**Concurrency**: The number of requests or operations in progress at the same time.

**p95 latency**: The duration at or below which 95% of measured operations complete; the slowest 5% take longer.

**p99 latency**: The duration at or below which 99% of measured operations complete; it highlights rarer tail latency than p95.
