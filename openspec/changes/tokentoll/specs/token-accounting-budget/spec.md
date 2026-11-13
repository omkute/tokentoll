# Spec Delta

## Purpose

Delivers accurate token-level measurement, cost calculation, multi-tenant budget quota enforcement, and high-performance asynchronous telemetry persistence into PostgreSQL.

## ADDED Requirements

### Requirement: Granular Token Accounting Across Request Modes
The system SHALL accurately measure prompt tokens, completion tokens, and cache-read tokens for both standard non-streaming requests and Server-Sent Events (SSE) streaming streams.

#### Scenario: Non-streaming response token extraction
- **WHEN** an upstream non-streaming response returns with usage metadata
- **THEN** the system records the exact prompt tokens, completion tokens, cached tokens, and total tokens from the response

#### Scenario: Streaming response token calculation
- **WHEN** an upstream response is delivered via SSE stream
- **THEN** the gateway inspects stream completion usage chunks or calculates tokens incrementally to ensure complete accounting

### Requirement: Dynamic Model Pricing and Cost Attribution
The system SHALL compute total monetary cost for each request based on a configurable model pricing matrix containing rates for input, output, and cached tokens.

#### Scenario: Request cost computation
- **WHEN** a request completes with 1,000 prompt tokens and 500 completion tokens for a model with defined pricing
- **THEN** the system calculates the accurate microdollar cost, attaches the cost to the request context, and tags it with tenant and team IDs

### Requirement: Multi-Tenant Budget Quota Enforcement
The system SHALL enforce soft and hard budget limits at organization, team, and virtual key levels, rejecting requests that exceed hard quotas.

#### Scenario: Request within budget threshold
- **WHEN** a request is initiated by a key belonging to a team with remaining monthly budget
- **THEN** the gateway permits the request to execute and decrements available quota

#### Scenario: Hard budget cap exceeded
- **WHEN** a team has consumed 100% of its allocated hard budget limit
- **THEN** the gateway rejects incoming requests with an HTTP 429 Too Many Requests status indicating budget quota exceeded

### Requirement: Asynchronous Telemetry Persistence
The system SHALL batch and persist request audit logs, token counts, and cost records to PostgreSQL asynchronously, avoiding any blocking overhead on the response path.

#### Scenario: Persisting usage metrics after response delivery
- **WHEN** a client request completes and the response stream is closed
- **THEN** the gateway enqueues the usage log record for non-blocking asynchronous batch write to PostgreSQL without increasing client response latency
