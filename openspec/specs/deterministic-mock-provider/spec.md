# deterministic-mock-provider Specification

## Purpose

Provides deterministic provider-adapter behavior for contract tests so success and failure semantics can be verified without live services, credentials, or timing-dependent fixtures.

## Requirements

### Requirement: Configurable deterministic behavior

The mock provider SHALL be configured with an explicit success, provider-error, or timeout outcome using only neutral contract values. Repeated invocations with the same valid request and configuration MUST produce the same observable result.

#### Scenario: Configured success repeats

- **WHEN** the mock provider is invoked repeatedly with the same valid request and success configuration
- **THEN** every invocation returns the same normalized response and usage values

#### Scenario: Configured behavior is incomplete

- **WHEN** the mock provider configuration omits data required for its selected outcome
- **THEN** mock construction fails deterministically before an invocation

### Requirement: Deterministic provider-error simulation

The mock provider SHALL simulate a provider failure as a configured normalized error with an explicit retryability classification. The result MUST contain no provider SDK object or unconfigured payload data.

#### Scenario: Retryable provider failure is simulated

- **WHEN** the mock is configured with a retryable provider-error outcome and receives a valid request
- **THEN** it fails with the exact configured neutral category, retryability value, and safe message

#### Scenario: Non-retryable provider failure is simulated

- **WHEN** the mock is configured with a non-retryable provider-error outcome and receives a valid request
- **THEN** it fails with the exact configured neutral category, retryability value, and safe message

### Requirement: Deterministic timeout simulation

The mock provider SHALL simulate an upstream timeout by returning the normalized timeout failure selected by configuration without relying on live network delay or external time.

#### Scenario: Timeout is simulated

- **WHEN** the mock is configured for timeout and receives a valid request
- **THEN** it deterministically fails with the neutral timeout category and the configured retryability classification

### Requirement: Invalid input precedes configured behavior

The mock provider SHALL validate normalized inputs before executing its configured provider outcome. Invalid requests MUST produce the neutral invalid-request failure rather than the configured success, provider-error, or timeout result.

#### Scenario: Invalid request reaches success mock

- **WHEN** a mock configured for success receives an invalid normalized request
- **THEN** it fails with a neutral invalid-request error and does not return the configured success response

#### Scenario: Invalid request reaches failure mock

- **WHEN** a mock configured for provider error or timeout receives an invalid normalized request
- **THEN** it fails with a neutral invalid-request error before the configured provider failure is executed

### Requirement: No external provider dependency

Mock-provider construction and invocation SHALL require no network access, provider credentials, environment credentials, provider SDK, persistence service, or external process.

#### Scenario: Contract tests run offline

- **WHEN** contract tests invoke the mock provider without network access or application credentials
- **THEN** all configured success and failure scenarios execute deterministically
