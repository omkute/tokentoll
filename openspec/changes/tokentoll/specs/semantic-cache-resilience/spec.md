# Spec Delta

## Purpose

Provides semantic response caching using embeddings and Redis to minimize latency and token expenditures, alongside rate limiting and circuit breaking resilience mechanisms.

## ADDED Requirements

### Requirement: Semantic Prompt Caching
The system SHALL evaluate incoming prompt embeddings against cached queries in Redis/vector storage and return cached completions when cosine similarity meets or exceeds the configured similarity threshold.

#### Scenario: High-similarity prompt achieves cache hit
- **WHEN** a client submits a prompt with similarity above the configured threshold (e.g., >= 0.95) to a cached entry for the same tenant and model
- **THEN** the gateway returns the cached completion with header `X-Cache: HIT`, avoiding an upstream provider call and reducing latency to under 15ms

#### Scenario: Low-similarity prompt triggers cache miss
- **WHEN** a client submits a prompt whose similarity to all cached entries is below the threshold
- **THEN** the gateway forwards the request to the upstream LLM provider, streams the response, and populates the cache asynchronously

### Requirement: Cache Savings Telemetry
The system SHALL record cache hit events, calculate estimated token and dollar savings, and report these metrics in tenant analytics dashboards.

#### Scenario: Calculating savings on cache hit
- **WHEN** a semantic cache hit occurs for a request with estimated 2,000 prompt tokens and 500 completion tokens
- **THEN** the system increments the tenant's cache savings counter and attributes zero upstream API charges for completion tokens

### Requirement: Distributed Rate Limiting and Concurrency Control
The system SHALL enforce Requests Per Minute (RPM), Tokens Per Minute (TPM), and concurrent in-flight request limits per virtual key and per tenant using Redis token buckets.

#### Scenario: Request rate within allowed limits
- **WHEN** an incoming request does not exceed the configured RPM or TPM threshold for the key
- **THEN** the gateway permits the request to execute and decrements the token bucket

#### Scenario: Rate limit exceeded
- **WHEN** a client exceeds the allocated RPM or TPM quota
- **THEN** the gateway returns an HTTP 429 Too Many Requests response with `Retry-After` header indicating required backoff duration

### Requirement: Upstream Circuit Breaking
The system SHALL monitor failure rates and response latency for each upstream model provider and automatically trip the circuit breaker when consecutive error thresholds are crossed.

#### Scenario: Provider failure trips circuit
- **WHEN** an upstream provider endpoint encounters consecutive 5xx errors or timeouts exceeding the trip threshold
- **THEN** the gateway marks the provider circuit as OPEN and redirects incoming traffic to alternate fallback providers immediately
