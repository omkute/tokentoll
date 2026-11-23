# provider-neutral-contracts Specification

## Purpose

Defines stable provider-independent values and adapter behavior so gateway code can use multiple model providers without importing provider-specific contracts.

## Requirements

### Requirement: Normalized generation request

The gateway SHALL represent a generation request as an immutable ordered list of messages with neutral `system`, `user`, or `assistant` roles, non-empty text content, and an optional positive integer output-token limit. The request MUST contain at least one message and MUST contain no provider SDK type or provider-specific field.

#### Scenario: Valid neutral request

- **WHEN** a request contains one or more valid neutral messages and an optional positive output-token limit
- **THEN** the request is accepted as a normalized generation request without provider-specific translation data

#### Scenario: Invalid neutral request

- **WHEN** a request has no messages, an unsupported role, empty message content, or a non-positive or fractional output-token limit
- **THEN** validation rejects the request before a provider adapter is invoked

### Requirement: Normalized generation response and usage

The gateway SHALL represent a completed generation with neutral text content, a finish reason, and usage counts. Input, output, and cache-read token counts MUST be non-negative integers and MUST NOT contain provider-specific usage objects.

#### Scenario: Successful response normalization

- **WHEN** an adapter completes a generation successfully
- **THEN** it returns neutral content, a neutral finish reason, and validated normalized usage counts

#### Scenario: Invalid normalized usage

- **WHEN** a response contains a negative, fractional, or missing required token count
- **THEN** contract validation rejects the response

### Requirement: Normalized provider errors

Provider failures SHALL cross the adapter boundary as neutral errors containing a stable category, a retryability classification, and a safe message. Neutral errors MUST NOT expose provider SDK error objects, credentials, authorization data, prompts, completions, or raw provider payloads.

#### Scenario: Provider failure is normalized

- **WHEN** a provider adapter encounters a provider-side failure
- **THEN** the caller receives a neutral error category, retryability classification, and safe diagnostic message

#### Scenario: Sensitive provider failure data exists

- **WHEN** a provider failure includes credentials, authorization data, request content, response content, or a raw provider payload
- **THEN** none of that sensitive material appears in the neutral error contract

### Requirement: Provider adapter boundary

A provider adapter SHALL accept only a normalized generation request, a unified model deployment, and an optional cancellation signal, and SHALL return a normalized response or fail with a normalized provider error. An adapter that supports streaming SHALL expose a streaming operation that returns an async iterable of normalized stream events. The adapter contract MUST NOT expose provider-specific request, response, or error types to its caller.

#### Scenario: Adapter succeeds

- **WHEN** a caller invokes an adapter with a valid normalized request and compatible model deployment
- **THEN** the adapter resolves with a normalized generation response

#### Scenario: Adapter rejects invalid input

- **WHEN** a caller invokes an adapter with an invalid normalized request
- **THEN** the adapter fails deterministically before provider behavior is executed

#### Scenario: Adapter streams

- **WHEN** a caller invokes a streaming adapter with a valid normalized request, compatible deployment, and cancellation signal
- **THEN** the adapter returns an async iterable of validated normalized stream events and exposes no provider-specific type

### Requirement: Normalized stream-event vocabulary

The gateway SHALL use provider-neutral content-delta, usage, and completion event variants for streaming. Each event MUST contain only the fields valid for its variant, and the vocabulary MUST remain independent of any wire transport. Mapping normalized events to SSE frames belongs to the HTTP boundary.

#### Scenario: Stream event is represented

- **WHEN** an adapter-facing component represents an incremental content, usage, or completion event
- **THEN** the event uses a neutral discriminated variant with only the fields valid for that variant

#### Scenario: Provider-specific event is supplied

- **WHEN** an event includes a provider-specific event name or provider SDK object
- **THEN** contract validation rejects it as a normalized stream event

### Requirement: Ordered stream event sequence

An adapter stream SHALL emit zero or more non-empty content-delta events, at most one usage event, and exactly one completion event, in that order. No event SHALL follow completion. A stream that violates this ordering, emits a duplicate usage or completion event, or ends without a completion event SHALL be treated as invalid.

#### Scenario: Valid sequence completes

- **WHEN** a stream emits content deltas, one usage event, and one completion event in order
- **THEN** the sequence is accepted and the completion event is the final event

#### Scenario: Usage is duplicated

- **WHEN** a stream emits more than one usage event
- **THEN** the sequence is rejected as invalid

#### Scenario: Stream ends without completion

- **WHEN** an iterator is exhausted without a completion event
- **THEN** the stream is treated as incomplete rather than successful

### Requirement: Invocation cancellation

A provider invocation MAY carry an `AbortSignal`. When the signal aborts, the adapter SHALL stop producing, end the iterable promptly, release its internal resources, and MUST NOT emit further events. Abort SHALL NOT be reported as a successful completion.

#### Scenario: Abort mid-stream

- **WHEN** the signal aborts after some content deltas have been emitted
- **THEN** the adapter stops iterating, emits no completion or usage event after the abort, and releases its resources

#### Scenario: Abort before first event

- **WHEN** the signal is already aborted before iteration begins
- **THEN** the adapter yields no events and ends the iterable without a completion event

#### Scenario: Late abort has no effect

- **WHEN** the signal aborts after a completion event has been emitted
- **THEN** the completed sequence remains valid and no further events are produced

### Requirement: Partial usage semantics

When a stream ends without a usage event, usage SHALL be treated as unknown. The gateway MUST NOT infer, estimate, or fabricate token counts for an incomplete stream, and partial content MUST NOT be reported as a completed generation.

#### Scenario: Abort before usage

- **WHEN** a stream is cancelled before the adapter emits usage
- **THEN** the result reports unknown usage rather than zero or estimated counts

#### Scenario: Failure before usage

- **WHEN** an adapter fails after emitting content but before emitting usage
- **THEN** the failure is normalized and no usage is reported
