# runtime-configuration Specification

## Purpose

Defines the environment-based startup settings that establish the service address and a finite shutdown grace period before any listener is opened.

## Requirements

### Requirement: Environment configuration contract
The service SHALL derive its startup configuration from `HOST`, `PORT`, `SHUTDOWN_GRACE_MS`, and `REQUEST_TIMEOUT_MS`, using documented defaults when a variable is absent.

#### Scenario: Variables are absent
- **WHEN** the process starts without `HOST`, `PORT`, `SHUTDOWN_GRACE_MS`, or `REQUEST_TIMEOUT_MS`
- **THEN** it uses `0.0.0.0`, `3000`, `10000` milliseconds, and `30000` milliseconds respectively

#### Scenario: Valid variables are provided
- **WHEN** the process starts with valid values for all supported variables
- **THEN** the resulting configuration contains those values without implicit coercion beyond parsing numeric strings

### Requirement: Startup configuration validation
The service SHALL validate the complete startup configuration before opening an HTTP listener. `HOST` MUST be non-empty, `PORT` MUST be an integer from 1 through 65535, `SHUTDOWN_GRACE_MS` MUST be a positive integer no greater than 60000, and `REQUEST_TIMEOUT_MS` MUST be an integer from 1 through 300000.

#### Scenario: Invalid port
- **WHEN** `PORT` is non-numeric, fractional, zero, negative, or greater than 65535
- **THEN** startup fails before an HTTP listener is opened

#### Scenario: Invalid shutdown grace period
- **WHEN** `SHUTDOWN_GRACE_MS` is non-numeric, fractional, zero, negative, or greater than 60000
- **THEN** startup fails before an HTTP listener is opened

#### Scenario: Invalid request timeout
- **WHEN** `REQUEST_TIMEOUT_MS` is non-numeric, fractional, zero, negative, or greater than 300000
- **THEN** startup fails before an HTTP listener is opened

#### Scenario: Empty host
- **WHEN** `HOST` is present but empty or whitespace-only
- **THEN** startup fails before an HTTP listener is opened

### Requirement: Safe configuration diagnostics
Configuration failure diagnostics SHALL identify each invalid variable without including the full environment or unrelated variable values.

#### Scenario: Configuration is rejected
- **WHEN** one or more supported environment variables are invalid
- **THEN** the diagnostic identifies the invalid variable names and does not dump the process environment
