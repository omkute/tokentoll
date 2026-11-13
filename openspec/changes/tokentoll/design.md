# Design

## Context

The system is designed as tokenToll, an Enterprise Multi-Tenant AI Gateway engineered with Node.js, Fastify, and PostgreSQL. It functions as an intermediary proxy between client applications and heterogeneous Large Language Model (LLM) providers (OpenAI, Anthropic, Azure OpenAI, self-hosted models). See `proposal.md` for background motivation and high-level scope.

The gateway must satisfy two conflicting demands: enterprise-grade control (deep tenant isolation, RBAC, SSO, exact token billing, guardrails) and ultra-low serving latency (< 5ms added routing overhead). To achieve this, the architecture explicitly bifurcates into a **Management Plane (Control)** and a **Data Plane (Serving)**.

```
                           +----------------------------------------+
                           |   Client Applications / SDK Callers    |
                           +-------------------+--------------------+
                                               |
                                     (Drop-in OpenAI API)
                                               v
+------------------------------------------------------------------------------------+
| DATA PLANE (Fastify Serving Pipeline)                                              |
|                                                                                    |
|  [ Virtual Key Auth & Cache ] ---> [ Quota & Rate Check ] ---> [ Security Guards ] |
|               |                                                       |            |
|               v                                                       v            |
|  (In-memory / Redis Cache)                                (PII / Injection Scan)   |
|                                                                       |            |
|                                                                       v            |
|  [ Semantic Cache Check ] (Hit -> Return Instant 10ms)                             |
|               | (Miss)                                                             |
|               v                                                                    |
|  [ Multi-Provider Fallback Router & Circuit Breaker ]                              |
|    - Global Frontier: OpenAI, Anthropic, Gemini, Azure, Mistral                    |
|    - Cheap Chinese Frontier: DeepSeek (V3/R1), Qwen, Moonshot, Zhipu               |
|    - High-Speed LPUs: Groq / Together AI                                           |
|               |                                                                    |
|               v (SSE Streaming & Protocol Normalizer via Undici)                   |
|  [ Upstream Provider Execution ]                                                   |
|               |                                                                    |
|               v                                                                    |
|  [ Async Telemetry Dispatcher ] ---> (Non-blocking Batch Queue)                    |
+---------------------------------------------------|--------------------------------+
                                                    |
                                                    v
+------------------------------------------------------------------------------------+
| MANAGEMENT PLANE & PERSISTENCE (PostgreSQL + Control Plane API)                    |
|                                                                                    |
|  - SSO / OIDC (Okta / Entra) & RBAC          - Asynchronous Usage & Billing Logs   |
|  - Tenant, Team & Virtual Key Vault          - PostgreSQL Connection Pool (Tuned)  |
|  - Budgets, Quotas & Model Catalog           - Analytics & Reporting Queries       |
+------------------------------------------------------------------------------------+
```

## Goals / Non-Goals

**Goals:**
- **Single-Digit Millisecond Serving Overhead**: Achieve p95 gateway latency overhead < 5ms for proxy routing and key verification.
- **Drop-in OpenAI Compatibility**: Full protocol compatibility for `/v1/chat/completions`, `/v1/models`, and `/v1/embeddings`.
- **Zero-Allocation Streaming Pipeline**: Stream SSE token chunks directly to callers with non-blocking backpressure handling.
- **Deep Multi-Tenant Partitioning**: Strict organizational data isolation and RBAC (Org Admin, Team Lead, Member, Auditor) backed by PostgreSQL.
- **Real-Time Token Accounting & Budgets**: Accurately capture input, output, and cache tokens across streaming/non-streaming calls, computing costs and enforcing hard/soft budget cutoffs.
- **High-Concurrency PostgreSQL Optimization**: Optimize connection pooling, table schemas, and batch inserts to sustain high concurrent requests without pool starvation.
- **Semantic Caching & Resilience**: Lower token expenditure and latency via Redis-backed semantic caching and multi-provider fallback chains.

**Non-Goals:**
- Hosting, training, or fine-tuning local model weights on gateway nodes.
- Replacing external identity providers (gateway delegates to OIDC/SSO providers like Okta/Entra).
- Proprietary SDK development (developers use standard OpenAI or Anthropic SDKs pointing to the gateway base URL).

## Decisions

### 1. Fastify as Core Engine over Express or NestJS
- **Decision**: Build both planes on Fastify using modular TypeScript plugins.
- **Rationale**: Fastify provides superior event-loop efficiency, integrated schema compilation (`fast-json-stringify` and `ajv`), and minimal routing overhead (~2-3x lower latency and higher RPS compared to Express/NestJS), which is crucial for staying within the < 5ms budget.
- **Alternatives Considered**:
  - *Express*: Widespread familiarity, but significantly higher allocation overhead, slower routing, and lacks built-in asynchronous lifecycle hooks.
  - *NestJS*: Feature-rich but introduces runtime reflection and dependency-injection overhead unnecessary for an ultra-low-latency data plane.

### 2. Upstream HTTP Dispatch via `undici` with Streaming Pass-Through
- **Decision**: Use Node.js native `undici` (via `fetch` or `undici.Pool`) for upstream communication and stream piping.
- **Rationale**: `undici` provides persistent HTTP/1.1 and HTTP/2 connection pooling, pipelining, and direct stream transform capabilities, ensuring streaming chunks (SSE) bypass full in-memory buffering.
- **Alternatives Considered**:
  - *Axios*: Buffers payloads in memory and has poor streaming ergonomics in Node.js.
  - *Node native `http` module*: Functional but requires manual connection pool tuning and verbose boilerplate compared to `undici`.

### 3. Virtual Key Authentication via Two-Tier In-Memory Cache
- **Decision**: Hash virtual keys (`tt_<random>`) with SHA-256. Validate keys against an in-memory LRU cache (L1) with Redis fallback (L2); PostgreSQL is queried only on cache miss or key update.
- **Rationale**: Direct database lookups per request would introduce 2-10ms of latency and overwhelm PostgreSQL under 5,000+ concurrent connections.
- **Alternatives Considered**:
  - *Querying PostgreSQL on every request*: Guarantees immediate revocation consistency but causes database connection starvation and adds 5-15ms latency per request.
  - *Stateless JWT API keys*: Eliminates DB lookup but prevents instant key revocation and dynamic budget quota checks.

### 4. Asynchronous Telemetry Ingestion with Batch Persist
- **Decision**: Decouple token billing and audit log writes from the request response cycle using an in-memory circular ring buffer flushed to PostgreSQL in micro-batches (e.g., every 100ms or 500 records).
- **Rationale**: Writing an `INSERT` to PostgreSQL synchronously on every request adds 3-10ms to response latency and saturates DB write IOPS.
- **Alternatives Considered**:
  - *Synchronous DB write in `onResponse` hook*: Drastically reduces throughput and increases tail latency.
  - *External message broker (Kafka/RabbitMQ)*: Increases operational complexity; a local batch buffer with Redis or direct PG multi-row inserts meets target scale with lower operational footprint.

### 5. Multi-Tenant Relational Schema & Partitioning in PostgreSQL
- **Decision**: Use PostgreSQL with relational foreign keys (`organization_id`, `team_id`, `key_id`), composite indexes on `(tenant_id, created_at)`, and optional monthly table partitioning on `request_logs`.
- **Rationale**: Provides ACID guarantees for budget ledger reconciliation and financial auditing while allowing fast time-series analytical queries for tenant dashboards.
- **Alternatives Considered**:
  - *Document DB (MongoDB)*: Lacks strong multi-table relational integrity for multi-tenant billing reconciliations.
  - *Separate database per tenant*: Overkill for hundreds of tenants, creates unmanageable connection pooling and migration overhead.

### 6. Semantic Caching Architecture (Redis + Vector Embeddings)
- **Decision**: Implement a two-phase cache check:
  - L1: Exact SHA-256 prompt hash lookup in Redis (0.5ms).
  - L2: Semantic similarity search via vector embeddings in Redis (using cosine similarity >= 0.95) for prompt intent matching.
- **Rationale**: Exact cache hits resolve instantly; semantic caching absorbs synonymous queries, cutting up to 30-50% of LLM API costs for repetitive enterprise workflows.
- **Alternatives Considered**:
  - *External Vector DB (Pinecone/Weaviate)*: Introduces additional network hop (>20ms), nullifying the latency advantage of caching for fast models.

### 7. Security Guardrail Pipeline
- **Decision**: Execute lightweight regex and heuristic token checks for PII (credit cards, SSNs, API tokens) and prompt injection directly in Fastify's `preHandler` hook. Heavier vector-based or LLM-based classifiers are executed asynchronously or selectively based on tenant policy.
- **Rationale**: Keeps common path latency within budget while guaranteeing baseline compliance.

### 8. Multi-Provider Protocol Normalization (Top 10 Providers)
- **Decision**: Standardize all incoming requests and outgoing responses on the OpenAI chat completion schema, utilizing a modular adapter layer for upstream execution:
  - *Native OpenAI Wire Compatibility*: DeepSeek, Alibaba Cloud Qwen (DashScope OpenAI endpoint), Moonshot AI, Mistral AI, Groq, and Azure OpenAI receive direct pass-through requests with custom base URLs, headers, and model aliases, requiring 0ms translation overhead.
  - *Normalized Protocol Mapping*: Anthropic Messages API and Google Gemini generateContent undergo bidirectional JSON/SSE transformation using compiled schema transformers to maintain < 5ms gateway routing latency.
- **Rationale**: Eliminates vendor lock-in and allows multi-tenant organizations to switch providers transparently without code changes in client applications.
- **Alternatives Considered**:
  - *Full heavy translation engine (LiteLLM Python proxy)*: High latency and memory overhead; lightweight Node.js streaming transformers maintain target latency bounds.

### 9. Cost-Aware & Resilient Fallback Routing Policies
- **Decision**: Support configurable routing policies per virtual key and tenant:
  - `cost-first`: Prioritizes ultra-low-cost frontier providers (DeepSeek-V3 at ~$0.14/M input, Qwen Turbo, Gemini Flash) with automatic escalation to premium models if needed.
  - `frontier-resilience`: Routes primarily to premium frontier models (Claude 3.5 Sonnet, GPT-4o) with automatic cross-cloud fallback (e.g., Azure OpenAI -> Anthropic -> DeepSeek) upon 5xx errors, rate limits (HTTP 429), or timeouts.
- **Rationale**: Delivers enterprise uptime resilience while enabling up to 80-90% cost savings for high-volume background workloads.
- **Alternatives Considered**:
  - *Static single-provider routing*: Exposes callers to outages and high token bills without dynamic failover.

## Risks / Trade-offs

- **[Risk: Heavy token counting / regex blocking Node.js event loop]**
  - *Mitigation*: Utilize WebAssembly-compiled tokenizers (`@dqbd/tiktoken`) and bounded-regex execution to prevent ReDoS. Prompts exceeding 32KB are token-counted asynchronously or streamed.
- **[Risk: PostgreSQL connection exhaustion under high concurrency]**
  - *Mitigation*: Configure `pg.Pool` with `max: 50-100` connections, employ connection pooling (PgBouncer when deploying multi-instance), and ensure data plane hot paths execute zero synchronous DB writes.
- **[Risk: SSE stream abort leaving dangling upstream connections]**
  - *Mitigation*: Listen to Fastify `reply.raw.on('close')` and invoke `AbortController.abort()` to terminate upstream requests immediately, preventing billing leakage and server resource hogging.
- **[Risk: Semantic cache poisoning or returning outdated answers]**
  - *Mitigation*: Enforce strict TTLs (default 24h), tenant-isolated cache namespaces (`cache:<org_id>:<model_id>`), and configurable similarity thresholds.

## Benchmarking & Performance Optimization Plan

To validate high-concurrency performance and PostgreSQL resilience:
1. **Tooling**: Employ `autocannon` and `k6` to simulate 100, 500, 1,000, and 5,000 concurrent virtual users hitting mock and live upstream endpoints.
2. **Metrics Measured**: Requests per second (RPS), p50, p95, p99 latency, event loop lag (`node:perf_hooks`), CPU utilization, and PostgreSQL active connection pool saturation.
3. **Database Tuning**:
   - `statement_timeout` and `idle_in_transaction_session_timeout` enforcement.
   - Batching `INSERT INTO request_logs` with `UNNEST()` for multi-row high-speed insertion.
   - Index optimization on `(organization_id, created_at DESC)` and `(virtual_key_id, created_at DESC)`.
