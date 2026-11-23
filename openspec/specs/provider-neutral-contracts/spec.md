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

A provider adapter SHALL accept only a normalized generation request and a unified model deployment, and SHALL return a normalized response or fail with a normalized provider error. The adapter contract MUST NOT expose provider-specific request, response, or error types to its caller.

#### Scenario: Adapter succeeds

- **WHEN** a caller invokes an adapter with a valid normalized request and compatible model deployment
- **THEN** the adapter resolves with a normalized generation response

#### Scenario: Adapter rejects invalid input

- **WHEN** a caller invokes an adapter with an invalid normalized request
- **THEN** the adapter fails deterministically before provider behavior is executed

### Requirement: Normalized stream-event vocabulary

The gateway SHALL define provider-neutral content-delta, usage, and completion event variants for future streaming boundaries. The vocabulary MUST remain independent of any wire transport and MUST NOT imply that streaming transport is available.

#### Scenario: Stream event is represented

- **WHEN** an adapter-facing component represents an incremental content, usage, or completion event
- **THEN** the event uses a neutral discriminated variant with only the fields valid for that variant

#### Scenario: Provider-specific event is supplied

- **WHEN** an event includes a provider-specific event name or provider SDK object
- **THEN** contract validation rejects it as a normalized stream event
