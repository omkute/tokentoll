# Spec Delta

## ADDED Requirements

### Requirement: Deterministic streaming simulation

For a success configuration, the mock provider SHALL expose a streaming operation that emits the configured response content as one or more deterministic non-empty content deltas, followed by exactly one usage event and one completion event. The deltas SHALL be documented, SHALL concatenate to the configured content, and SHALL NOT depend on submitted text, clocks, or network access. The mock SHALL honor the invocation cancellation signal before each yield.

#### Scenario: Success streams deterministically

- **WHEN** a success mock is streamed repeatedly with the same valid request and configuration
- **THEN** every invocation yields the same deltas, usage event, and completion event in the same order

#### Scenario: Stream aborts without completion

- **WHEN** the cancellation signal aborts before the mock yields its completion event
- **THEN** the mock stops yielding, emits no completion event, and releases its resources

#### Scenario: Failure configuration fails the stream

- **WHEN** a provider-error or timeout mock receives a valid streaming invocation
- **THEN** it fails with the configured normalized error before yielding a content delta
