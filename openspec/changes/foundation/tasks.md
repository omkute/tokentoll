# Tasks

## 1. Bun and TypeScript Toolchain

- [x] 1.1 Create `package.json` with Node.js ESM metadata, Fastify runtime dependency, TypeScript/ESLint/Prettier development tooling, and the agreed Bun scripts; generate and commit `bun.lock`, then verify `bun install --frozen-lockfile` succeeds without changing it.
- [x] 1.2 Add strict production and no-emit TypeScript configuration plus flat ESLint and Prettier configuration, then verify a minimal typed source fixture passes `bun run format:check`, `bun run lint`, and `bun run typecheck` before replacing the fixture with the service modules.
- [x] 1.3 Add repository ignore rules for dependencies, build output, coverage, and local environment files, then verify `git status --short` does not show ignored generated artifacts after an install and build.

## 2. Runtime Configuration

- [x] 2.1 Implement the read-only configuration model and parser in `src/config.ts`, then verify focused Bun tests cover defaults, valid overrides, whitespace, integer syntax, every numeric boundary, and multiple simultaneous invalid variables.
- [x] 2.2 Implement structured safe configuration errors that expose invalid variable names without environment dumps, then verify focused tests assert diagnostics omit unrelated environment keys and their values.
- [x] 2.3 Document `HOST`, `PORT`, and `SHUTDOWN_GRACE_MS`, their defaults and ranges, and the local-only `HOST=127.0.0.1` option in the project README; verify every documented value matches the runtime-configuration spec and parser tests.

## 3. Fastify Application and Health Boundary

- [x] 3.1 Implement a side-effect-free Fastify application factory in `src/app.ts` with unauthenticated `GET /health`, then verify Fastify injection tests assert status 200, JSON content type, and the exact `{ "status": "ok" }` body.
- [x] 3.2 Add a health-scope test proving the response contains no dependency or readiness fields, and document the endpoint as liveness-only in the project README; verify the test and documented response match the service-health spec.

## 4. Production Process Lifecycle

- [x] 4.1 Implement `src/server.ts` so it validates configuration before constructing and listening with one Fastify instance, reports startup failures safely, and sets non-zero exit status; verify child-process tests cover invalid configuration and an unavailable listening address without observing an opened service.
- [x] 4.2 Implement idempotent `SIGINT` and `SIGTERM` handling that stops new acceptance, awaits `fastify.close()`, races it against the configured grace period, and clears the timer; verify focused lifecycle tests cover successful closure, duplicate signals, closure failure, and timeout failure.
- [x] 4.3 Add production-process tests that build and spawn the Node.js artifact on an ephemeral port, wait for a successful health response, send each supported signal, and assert listener closure plus zero exit status; verify bounded cleanup terminates the child even when an assertion fails.
- [x] 4.4 Document build, start, signal shutdown, and failure exit behavior in the project README, then verify the documented production commands run against the built artifact as written.

## 5. Integrated Quality Verification

- [x] 5.1 Finalize the non-mutating aggregate `bun run check` pipeline so it verifies formatting, linting, types, tests, and production build output; run it and record the exact command and actual result in the implementation handoff.
- [x] 5.2 From a clean dependency state, run `bun install --frozen-lockfile`, `bun run check`, and a production health/start/stop smoke test; record actual outcomes and confirm no PostgreSQL, Redis, authentication, provider, routing, streaming, cache, billing, telemetry, guardrail, or benchmark implementation entered the change.
- [x] 5.3 Run `openspec validate foundation --strict` and review the implementation against FR-002, FR-003, NFR-003, TEST-001, security-sensitive logging, concurrency, resource lifecycle, and performance-claim constraints; resolve all findings and report the final validation result without claiming either performance objective.

## Workflow follow-up

- Review the completed implementation and its recorded evidence before accepting the change.
- Archive the change only after implementation and verification are approved.
