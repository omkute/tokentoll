# Proposal

## Why

Modern enterprises adopting Large Language Models (LLMs) struggle with unpredictable AI expenses, compliance and data security risks, lack of granular multi-tenant cost attribution, and provider lock-in or outages. This change introduces tokenToll, an Enterprise Multi-Tenant AI Gateway built on Node.js Fastify and PostgreSQL, providing a drop-in OpenAI-compatible proxy with sub-millisecond to single-digit millisecond overhead, deep tenant isolation, RBAC, virtual key management, token-level cost accounting, resilient routing, and security guardrails.

## What Changes

- **Foundation & Management Plane**:
  - Multi-tenant data model with strict tenant isolation, SSO/OIDC integration (Okta/Entra), and Role-Based Access Control (RBAC: Org Admin, Team Lead, Member, Auditor).
  - Virtual API key provisioning with tenant/team binding, granular model permissions, budget caps, and secure upstream provider credential storage.
  - Management REST API for tenants, teams, virtual keys, budgets, and audit logs.
- **Data Plane (Fastify Serving Engine)**:
  - High-concurrency, ultra-low-latency drop-in OpenAI-compatible proxy engine (`/v1/chat/completions`, `/v1/embeddings`, `/v1/models`).
  - High-performance streaming (Server-Sent Events) pipeline with non-blocking backpressure handling.
  - Multi-provider model routing with dynamic fallback chains (e.g., Azure OpenAI -> Anthropic -> Self-hosted / Open-source endpoints) and circuit breaking.
- **Accounting & Quotas**:
  - Exact token-level accounting (input tokens, output tokens, cached tokens) across streaming and non-streaming requests.
  - Dynamic model pricing catalog and real-time cost calculation per tenant/team/user/key.
  - Hard and soft budget enforcement with atomic pre-allocation checks and non-blocking asynchronous usage telemetry persisted to PostgreSQL.
- **Resilience & Caching**:
  - Semantic caching using Redis and vector embeddings to eliminate redundant LLM calls and reduce latency.
  - Distributed token bucket rate limiting and concurrency throttling per tenant.
- **Security Guardrails**:
  - Inbound PII masking/redaction and prompt injection detection filters.
  - Outbound content validation and credential scrubbing.

## Capabilities

### New Capabilities

- `identity-tenant-access`: Multi-tenant organization hierarchy, SSO/OIDC authentication (Okta/Entra), RBAC roles, and tenant data partitioning.
- `virtual-key-management`: Virtual API key issuance, scoping, lifecycle management, and encrypted upstream provider credential mapping.
- `gateway-proxy-core`: High-throughput Fastify proxy engine providing OpenAI API compatibility, SSE stream processing, low-overhead request execution, and provider failover routing.
- `token-accounting-budget`: Real-time token metering (prompt, completion, cache), cost calculations, budget quota enforcement, and asynchronous telemetry persistence into PostgreSQL.
- `semantic-cache-resilience`: Redis- and vector-backed semantic response caching, cache hit token savings, circuit breakers, and rate-limiting resilience.
- `security-guardrails`: Inbound PII detection/masking, prompt injection protection filters, and outbound content sanitization.

### Modified Capabilities

*(None - greenfield project)*

## Impact

- **APIs**: Exposes control plane administrative endpoints (`/api/v1/admin/*`, `/api/v1/keys/*`, `/api/v1/tenants/*`) and data plane AI serving endpoints (`/v1/chat/completions`, `/v1/models`, `/v1/embeddings`).
- **Dependencies**: Fastify ecosystem (`fastify`, `@fastify/sensible`, `@fastify/jwt`, `@fastify/cors`), PostgreSQL client/pool (`pg`, `drizzle-orm` or `pg-pool`), Redis client (`ioredis`), tiktoken / tokenizers, vector similarity tools, Vitest, autocannon for load benchmarking.
- **Infrastructure**: PostgreSQL database (with connection pooling and indexing optimized for high concurrency), Redis instance for caching/rate-limiting, environment configurations for provider keys and OAuth/OIDC credentials.
