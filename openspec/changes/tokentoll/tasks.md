# Tasks

## 1. Project Scaffolding & Foundation Infrastructure

- [ ] 1.1 Initialize Node.js TypeScript project with Fastify, Vitest, TypeScript configuration, and linting rules, verifying `npm test` runs cleanly
- [ ] 1.2 Implement PostgreSQL connection pool (`pg.Pool`), database migration framework, and health check endpoint, verifying DB connection integration test passes
- [ ] 1.3 Design and apply database schema for multi-tenant hierarchy (organizations, teams, memberships, roles), verifying schema migration scripts execute cleanly

## 2. Authentication, RBAC & Virtual Key Management (Phase 1)

- [ ] 2.1 Implement SSO and OIDC authentication integration supporting Okta and Microsoft Entra ID with session JWT issuance, verifying OIDC auth flow unit tests pass
- [ ] 2.2 Implement Role-Based Access Control (RBAC) middleware enforcing Org Admin, Team Lead, Member, and Auditor permissions, verifying authorization permission matrix tests pass
- [ ] 2.3 Implement virtual API key generator (`tt_...`), SHA-256 hash storage in PostgreSQL, and fast LRU cache lookup, verifying key generation and authentication unit tests pass
- [ ] 2.4 Implement AES-256-GCM upstream provider credential vault for securely storing and resolving provider API keys and custom base URLs across top 10 providers (OpenAI, Anthropic, Gemini, Azure, DeepSeek, Qwen, Moonshot, Zhipu, Mistral, Groq), verifying encryption and decryption tests pass
- [ ] 2.5 Expose management REST APIs for tenant organizations, teams, virtual keys, and provider secrets (`/api/v1/tenants`, `/api/v1/teams`, `/api/v1/keys`), verifying integration tests for all CRUD endpoints

## 3. Data Plane Fastify Proxy Engine & Streaming (Phase 2)

- [ ] 3.1 Implement Fastify drop-in OpenAI-compatible endpoints (`/v1/chat/completions`, `/v1/models`, `/v1/embeddings`) with schema validation and multi-provider protocol normalization layer, verifying mock client requests receive compliant OpenAI responses across native and translated providers
- [ ] 3.2 Build zero-allocation Server-Sent Events (SSE) streaming proxy pipeline using `undici` with client abort detection and socket cleanup, verifying streaming SSE test passes
- [ ] 3.3 Implement token accounting engine for prompt, completion, and cache tokens using `@dqbd/tiktoken` across streaming and non-streaming responses, verifying token counting tests pass
- [ ] 3.4 Build dynamic model pricing catalog supporting frontier and ultra-low Chinese provider tiers (e.g. DeepSeek-V3, Qwen, Gemini Flash) with cache read discounts, verifying cost calculations against unit test pricing vectors
- [ ] 3.5 Implement asynchronous non-blocking telemetry write buffer that batches request audit logs and persists them to PostgreSQL without increasing client latency, verifying async batch flush test passes
- [ ] 3.6 Implement tenant and team budget quota enforcement (soft and hard limits) blocking calls that exceed hard limits with HTTP 429, verifying budget enforcement tests pass

## 4. Resilience & Semantic Caching (Phase 3)

- [ ] 4.1 Implement distributed Redis token bucket rate limiter (RPM, TPM, concurrent requests) per tenant and virtual key, verifying rate limit test passes
- [ ] 4.2 Build multi-provider routing and fallback execution chain supporting cost-optimized and high-resilience policies (e.g., Azure OpenAI -> DeepSeek-V3 -> Anthropic) with timeout controls, verifying automatic fallback unit tests pass
- [ ] 4.3 Implement circuit breaker mechanism tripping on consecutive provider 5xx errors or timeouts, verifying circuit state transition tests pass
- [ ] 4.4 Implement two-tier semantic caching with exact Redis hash lookup and vector similarity search, returning cached completions with `X-Cache: HIT` for similarity >= 0.95, verifying cache hit and miss tests pass

## 5. Security Guardrails (Phase 4)

- [ ] 5.1 Implement inbound PII detection and redaction pre-handler filter (credit cards, SSNs, secrets), verifying regex and redaction tests pass
- [ ] 5.2 Implement prompt injection and jailbreak heuristic detection filter, verifying threat pattern rejection tests pass
- [ ] 5.3 Implement outbound response content inspector to sanitize potential credential leaks before returning data to clients, verifying output scrubbing tests pass

## 6. High-Concurrency Benchmarking & PostgreSQL Optimization

- [ ] 6.1 Create automated benchmarking suite using `autocannon` simulating 100, 500, 1,000, and 5,000 concurrent virtual users hitting the gateway proxy, verifying benchmark script execution
- [ ] 6.2 Optimize PostgreSQL connection pool parameters, batch insertion chunk sizes, and composite indexing (`organization_id`, `created_at`), verifying database write latency stays under 10ms under peak load
- [ ] 6.3 Benchmark and verify p95 gateway latency overhead remains under 5ms (excluding upstream response time), documenting performance benchmark results in `docs/benchmarks.md`

## Workflow follow-up

- Validate all OpenSpec change artifacts with `openspec validate tokentoll --strict`.
- Archive the change after implementation and verification are complete.
