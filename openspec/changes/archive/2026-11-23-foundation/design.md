# Design

## Context

The repository contains documentation and OpenSpec planning artifacts but no application, package metadata, or tests. See [proposal.md](proposal.md) for motivation and [specs](specs/) for the accepted behavior of this change. The foundation must run as a Node.js/TypeScript Fastify process, use Bun for dependency and task management, remain independently testable, and introduce no later-milestone infrastructure.

## Goals / Non-Goals

**Goals:**

- Keep application construction independent from process startup so HTTP behavior can be tested without binding a socket.
- Validate a small immutable configuration object before creating or listening with Fastify.
- Make startup and shutdown outcomes explicit, bounded, and testable.
- Provide one reproducible aggregate quality command while retaining narrow commands for local diagnosis.
- Produce ordinary Node.js-compatible JavaScript as the production artifact.

**Non-Goals:**

- Define the future gateway request contract, provider seam, telemetry path, control plane, persistence, deployment topology, readiness model, or performance benchmark.
- Introduce a dependency-injection framework, configuration service, container image, CI platform configuration, or generalized plugin architecture.
- Treat the health response as evidence of downstream readiness or production readiness.

## Decisions

### Separate application construction from the executable bootstrap

Use three focused runtime modules:

- `src/config.ts` parses and validates only `HOST`, `PORT`, and `SHUTDOWN_GRACE_MS` into a read-only configuration value.
- `src/app.ts` constructs a Fastify instance and registers the health route, but never reads the environment, installs signal handlers, or opens a listener.
- `src/server.ts` is the executable boundary. It loads configuration, constructs the app, starts the listener, owns signal handlers, and converts startup or shutdown failures into process exit status.

This keeps configuration unit tests and Fastify injection tests narrow while reserving child-process tests for behavior that truly depends on signals and sockets. A single module was considered, but it would couple importing the application to environment and process side effects. A larger framework was rejected because M1 has no dependency graph that justifies it.

### Parse configuration without an additional schema library

Implement explicit parsing for the three supported variables, including whitespace handling, integer syntax, ranges, defaults, and a structured configuration error listing invalid variable names. The bootstrap reports the error without serializing `process.env` or configuration values.

A schema-validation dependency was considered, but three scalar fields do not justify another runtime package or abstraction. If later milestones create nested or shared configuration, a future change can adopt a schema library without changing this capability's observable contract.

### Use Fastify's lifecycle as the listener ownership boundary

The bootstrap calls `listen` only after configuration succeeds. On the first `SIGINT` or `SIGTERM`, it removes or guards signal handling against duplicate shutdown work, starts `fastify.close()`, and races closure against one timeout derived from `SHUTDOWN_GRACE_MS`. The timeout is always cleared after settlement. Successful closure exits cleanly; timeout or closure failure is reported and produces a non-zero exit status.

Fastify owns connection admission and draining, avoiding a parallel raw Node HTTP lifecycle. Immediate termination on the first signal was rejected because it can orphan in-flight work. An unbounded wait was rejected because shutdown must have a finite operational outcome.

### Keep liveness static and dependency-free

Register only `GET /health`, returning the literal JSON object `{ status: "ok" }`. It performs no network, filesystem, provider, database, or cache access. This makes liveness cheap and deterministic and prevents future dependency decisions from leaking into M1. A combined liveness/readiness endpoint was rejected because the foundation has no downstream dependencies and the semantics would become unstable as they are added.

### Compile with TypeScript and test with Bun's built-in runner

Use TypeScript in strict mode to emit Node.js-compatible ESM into `dist/`. Use Bun's built-in test runner for unit and integration tests, Fastify injection for the health boundary, and a child process using the built artifact for startup and signal-shutdown assertions. The test command builds before process-level tests so those tests exercise the production artifact.

Vitest or Jest was considered, but Bun already provides the required runner and avoiding a second test runtime keeps the foundation smaller. Running TypeScript directly in production was rejected because FR-002 and FR-003 require a production build that can be verified independently.

### Use focused standard quality tooling behind Bun scripts

Use Prettier for formatting, ESLint with TypeScript support for linting, `tsc --noEmit` for type checking, Bun's test runner for tests, and `tsc` for the production build. Expose `format`, `format:check`, `lint`, `typecheck`, `test`, `build`, `start`, and an aggregate `check` script. `check` is non-mutating and runs all required gates; scripts stop with a non-zero status when a constituent command fails.

Combining linting and formatting into one opaque tool invocation was rejected because separate gates produce clearer failure evidence. Adding benchmark, infrastructure, or specification-validation commands to the application quality aggregate was rejected as outside the M1 application quality contract; OpenSpec validation remains a planning/review verification step.

## Risks / Trade-offs

- [Hand-written configuration parsing can drift as settings grow] → Keep parsing centralized and covered by table-driven boundary tests; reconsider a schema library only when a later approved change expands the configuration model.
- [A forced process exit after the grace period may terminate unfinished requests] → Make the grace period explicit and bounded, reject invalid values, and report timeout as a failure rather than implying graceful completion.
- [Signal tests can be timing-sensitive] → Spawn the built artifact on an ephemeral port, wait for a positive health response before signaling, use bounded test timeouts, and always terminate the child in test cleanup.
- [Binding to `0.0.0.0` by default exposes the listener on all interfaces] → Retain the deployable-container default required by the selected contract and document `HOST=127.0.0.1` for local-only binding.
- [A static liveness probe cannot detect downstream failure] → Preserve narrow liveness semantics; add readiness only in a later change with real dependencies and an explicit contract.

## Migration Plan

This is a greenfield foundation with no existing runtime to migrate. Implementation adds package metadata, configuration, source, tests, and documentation; verification uses a frozen Bun install, the aggregate quality command, strict OpenSpec validation, and a production-process smoke test. Rollback consists of reverting the foundation files because the change introduces no persistence, external state, or deployment migration.
