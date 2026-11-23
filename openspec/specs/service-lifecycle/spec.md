# service-lifecycle Specification

## Purpose

Defines how the deployable gateway process starts, accepts HTTP traffic, and terminates without leaving its listener or in-flight requests orphaned.

## Requirements

### Requirement: Production process startup
The production build SHALL start a single HTTP service only after startup configuration has been validated, and it SHALL report a non-zero process exit status when startup fails.

#### Scenario: Valid startup
- **WHEN** the production start command runs with valid configuration and an available listening address
- **THEN** the process starts one HTTP listener on the configured address

#### Scenario: Listener startup failure
- **WHEN** the configured listening address cannot be bound
- **THEN** the process reports the startup failure and terminates with a non-zero exit status

### Requirement: Graceful signal shutdown
The process SHALL handle `SIGINT` and `SIGTERM` by stopping acceptance of new connections, allowing active requests to drain within a finite grace period, closing the HTTP listener, and then exiting successfully.

#### Scenario: Shutdown with no active request
- **WHEN** the running process receives `SIGINT` or `SIGTERM` while no request is active
- **THEN** it closes the HTTP listener and exits with a zero status

#### Scenario: Shutdown with an active request
- **WHEN** the running process receives `SIGINT` or `SIGTERM` while a request is active
- **THEN** it rejects new connections, permits the active request to finish within the configured grace period, closes the listener, and exits with a zero status

### Requirement: Bounded shutdown failure
The process SHALL bound graceful shutdown by the configured grace period and SHALL report a non-zero exit status if listener closure does not complete within that period.

#### Scenario: Shutdown exceeds grace period
- **WHEN** listener closure remains incomplete at the end of the configured shutdown grace period
- **THEN** the process reports the shutdown failure and terminates with a non-zero exit status
