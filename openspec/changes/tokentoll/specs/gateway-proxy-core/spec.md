# Spec Delta

## Purpose

Provides a drop-in OpenAI-compatible proxy interface with sub-millisecond to single-digit millisecond routing overhead, streaming SSE pipeline, and resilient provider failover chains.

## ADDED Requirements

### Requirement: Drop-in OpenAI API Compatibility
The system SHALL expose standard endpoints including `/v1/chat/completions`, `/v1/models`, and `/v1/embeddings` conforming to OpenAI request and response specifications.

#### Scenario: Non-streaming chat completion request
- **WHEN** a client submits a valid JSON payload to `/v1/chat/completions` using an authorized virtual key
- **THEN** the gateway proxies the request to the target upstream provider and returns a standard OpenAI chat completion JSON response

#### Scenario: Listing models endpoint
- **WHEN** an authorized client sends a GET request to `/v1/models`
- **THEN** the gateway returns an OpenAI-compliant list containing models authorized for the caller's virtual key

### Requirement: Low Latency Gateway Overhead
The system SHALL execute pre-routing checks, key resolution, and telemetry initialization with gateway routing overhead of under 5 milliseconds at p95 under standard load.

#### Scenario: Evaluating gateway routing overhead
- **WHEN** incoming requests are processed during steady-state operations
- **THEN** the internal gateway processing time (excluding upstream provider latency) does not exceed 5ms for 95% of requests

### Requirement: Server-Sent Events Streaming Pass-through
The system SHALL support real-time chunk streaming via Server-Sent Events (SSE) when `stream: true` is requested, delivering chunks to the client without buffering the full response.

#### Scenario: Client requests streaming response
- **WHEN** a client initiates a request with `stream: true`
- **THEN** the gateway sets response headers to `text/event-stream` and pipes SSE chunks from the upstream provider to the client immediately as chunks arrive

#### Scenario: Client disconnects during streaming
- **WHEN** a client terminates the TCP/HTTP connection mid-stream
- **THEN** the gateway detects client abort, closes the upstream connection, and records partial token consumption without crashing

### Requirement: Multi-Provider Routing and Fallback Chains
The system SHALL route requests across configured provider backends (e.g., Azure OpenAI, Anthropic, Direct OpenAI) and execute sequential fallback when upstream timeouts or 5xx errors occur.

#### Scenario: Primary provider returns 5xx error
- **WHEN** the primary upstream provider returns an HTTP 500 or 503 error
- **THEN** the gateway transparently invokes the secondary provider in the fallback chain and fulfills the request without client-visible error

#### Scenario: All providers in fallback chain fail
- **WHEN** all providers in the configured fallback chain fail or time out
- **THEN** the gateway returns an HTTP 502 Bad Gateway response with diagnostic information in error headers
