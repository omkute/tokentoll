# tokenToll

**A provider-neutral, multi-tenant gateway for reliable and governed access to
large language models.**

tokenToll aims to give application teams one consistent interface for multiple
LLM providers while centralizing routing, reliability, security, usage policy,
and observability. Instead of every product rebuilding provider integrations and
operational safeguards, the gateway is designed to make those concerns explicit,
testable, and reusable.

## Project goals

- Keep application contracts independent of provider-specific SDKs.
- Route requests across eligible model deployments with bounded failure handling.
- Support non-streaming and streaming traffic with cancellation and cleanup.
- Enforce tenant-aware identity, quotas, budgets, credentials, and governance.
- Produce trustworthy usage and audit data without blocking the request path.
- Measure performance through reproducible benchmarks rather than unsupported
  claims.

## Current status

The deployable foundation is implemented. It includes:

- A strict Node.js and TypeScript Fastify service.
- Validated environment configuration before the listener opens.
- An unauthenticated `GET /health` process-liveness endpoint.
- Graceful, time-bounded `SIGINT` and `SIGTERM` shutdown.
- Safe startup and shutdown diagnostics that avoid environment dumps.
- Unit, integration, and production-process lifecycle tests.
- Formatting, linting, type checking, tests, and production builds through Bun.

Provider adapters, proxy endpoints, routing, tenancy, billing, caching, and
guardrails are planned milestones and are not presented as completed features.

## Planned gateway features

- Provider-neutral request, response, usage, stream-event, and error contracts.
- Deterministic mock providers followed by approved live-provider adapters.
- OpenAI-compatible non-streaming proxy support and SSE streaming.
- Deadline propagation, cancellation, bounded retries, fallback, and circuits.
- Cost-aware deployment routing using consistent token-pricing fields.
- Tenant identity, RBAC, virtual keys, and encrypted provider credentials.
- Token accounting, budgets, asynchronous telemetry, distributed limits, and
  controlled caching.
- PII, prompt-injection, and output-scrubbing policy boundaries.

## Architecture principles

The design keeps provider behavior behind adapters, separates the
latency-sensitive data plane from administrative control-plane work, and treats
tenant identity as a data-boundary invariant. Concurrency, queues, retries,
bodies, buffers, timers, and cache lifetimes must remain bounded. Sensitive
prompts, completions, credentials, and authorization data are excluded from logs
by default.

## Technology

- Node.js 22+, TypeScript, and Fastify
- Bun for dependency management and task execution
- ESLint and Prettier for static quality checks
- Bun's test runner for unit and integration coverage
- OpenSpec for specification-driven delivery

## Run locally

```sh
bun install --frozen-lockfile
bun run build
HOST=127.0.0.1 bun run start
```

The service starts on port `3000` by default. Verify liveness with:

```sh
curl http://127.0.0.1:3000/health
```

```json
{ "status": "ok" }
```

### Runtime configuration

| Variable            | Default   | Valid values                                  |
| ------------------- | --------- | --------------------------------------------- |
| `HOST`              | `0.0.0.0` | A non-empty string after whitespace trimming  |
| `PORT`              | `3000`    | A decimal integer from `1` through `65535`    |
| `SHUTDOWN_GRACE_MS` | `10000`   | A decimal integer from `1` through `60000` ms |

Invalid configuration fails before the HTTP listener opens. `GET /health`
reports process liveness only; it does not claim downstream readiness.

## Development

```sh
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run build
bun run check
```

`bun run check` is the non-mutating aggregate verification command.

## Documentation

- [Vision](docs/vision.md)
- [Requirements](docs/requirements.md)
- [Architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [Architecture decisions](docs/adr/README.md)

The performance goals of 5,000 RPS and p95 gateway overhead below 5 ms remain
unverified objectives until a reproducible benchmark demonstrates them.
