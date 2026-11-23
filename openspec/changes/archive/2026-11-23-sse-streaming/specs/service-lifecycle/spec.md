# Spec Delta

## MODIFIED Requirements

### Requirement: Graceful signal shutdown

The process SHALL handle `SIGINT` and `SIGTERM` by stopping acceptance of new connections, aborting active streaming responses and cancelling their adapter work, allowing active non-streaming requests to drain within a finite grace period, closing the HTTP listener, and then exiting successfully. A stream aborted by shutdown SHALL end without a normal completion marker.

#### Scenario: Shutdown with no active request

- **WHEN** the running process receives `SIGINT` or `SIGTERM` while no request is active
- **THEN** it closes the HTTP listener and exits with a zero status

#### Scenario: Shutdown with an active request

- **WHEN** the running process receives `SIGINT` or `SIGTERM` while a non-streaming request is active
- **THEN** it rejects new connections, permits the active request to finish within the configured grace period, closes the listener, and exits with a zero status

#### Scenario: Shutdown with an active stream

- **WHEN** the running process receives `SIGINT` or `SIGTERM` while a streaming response is open
- **THEN** it aborts the adapter work, ends the response without `[DONE]`, releases admission capacity, closes the listener within the grace period, and exits with a zero status
