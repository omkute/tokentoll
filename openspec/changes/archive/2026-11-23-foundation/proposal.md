# Proposal

## Why

tokenToll needs the smallest deployable service and repeatable quality loop before provider-facing capabilities can be added safely. This change establishes the M1 foundation while preserving the roadmap boundary that keeps later gateway features out of the initial process.

## What Changes

- Add a Node.js and TypeScript Fastify service that can be built for production and started with Bun-managed tasks.
- Add an environment-based configuration boundary that validates required startup settings and rejects invalid configuration clearly.
- Add a probe-suitable health endpoint with a stable success contract.
- Add graceful process shutdown that stops accepting work and closes the HTTP listener.
- Add Bun commands for formatting, linting, type checking, tests, and production-build verification, with non-zero failures.
- Add focused configuration, health-route, startup, and shutdown tests.
- Exclude PostgreSQL, Redis, authentication, provider integrations, routing, streaming, caching, billing, telemetry, and content-security guardrails from this change.

## Capabilities

### New Capabilities

- `service-lifecycle`: Starting the production service and closing its listener cleanly during process shutdown.
- `runtime-configuration`: Loading and validating startup configuration from the environment before the service listens.
- `service-health`: Exposing a stable liveness/health response suitable for an infrastructure probe.
- `project-quality-checks`: Providing deterministic Bun tasks for formatting, linting, type checking, tests, and production-build verification.

### Modified Capabilities

None.

## Impact

This change introduces the first application and test structure, Node.js/TypeScript/Fastify runtime dependencies, Bun package metadata and lockfile, build and quality-tool configuration, and an HTTP health API. It implements only requirements FR-002, FR-003, NFR-003, TEST-001, PROC-001, PROC-002, and PROC-003 as applicable to M1; it does not claim either performance objective or production readiness.
