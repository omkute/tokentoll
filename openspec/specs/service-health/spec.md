# service-health Specification

## Purpose

Defines a stable, inexpensive liveness endpoint that infrastructure probes can use to determine whether the gateway process can serve HTTP requests.

## Requirements

### Requirement: Liveness endpoint
The service SHALL expose `GET /health` without authentication and return HTTP 200 with the JSON body `{ "status": "ok" }` while the process is live and accepting requests.

#### Scenario: Liveness probe succeeds
- **WHEN** a client sends `GET /health` to a running service that is accepting requests
- **THEN** the response has status 200, a JSON content type, and body `{ "status": "ok" }`

### Requirement: Liveness scope
The health response SHALL describe process liveness only and SHALL NOT claim readiness of databases, providers, caches, telemetry, or other later-milestone dependencies.

#### Scenario: Foundation health response is inspected
- **WHEN** a client receives a successful response from `GET /health`
- **THEN** the response contains only the foundation liveness status and no dependency status fields
