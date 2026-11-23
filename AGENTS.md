# Repository Guidelines

## Read Before Acting

Start with `docs/README.md`, then read the documents it routes to for the task. `requirements.txt` is the retained source input; `docs/requirements.md` and `docs/architecture.md` are the maintained project requirements and constraints. OpenSpec main specs describe accepted behavior, while `openspec/changes/<change>/` contains change-specific proposals, designs, and tasks.

Application work proceeds only through an approved OpenSpec change. M1–M3 are implemented, verified, and archived; M4–M10 remain unimplemented. If sources disagree, stop and surface the conflict.

## Working Protocol

1. Inspect repository state, relevant docs, active OpenSpec changes, and incomplete tasks.
2. State the approved scope and address one task at a time.
3. Explain architectural options and tradeoffs before requesting a decision.
4. Follow the OpenSpec lifecycle: explore, propose, specify, design, plan, implement, review, verify, then archive.
5. Obtain explicit permission before writing application code, installing dependencies, initializing OpenSpec, changing infrastructure, committing, or deploying.

Keep each milestone limited to its approved scope; the completed foundation covers only the Node.js/TypeScript Fastify process, environment configuration, health endpoint, and quality checks. Use Bun for package management and task execution. Do not pull later capabilities into an earlier milestone.

## Engineering Guardrails

Keep provider contracts neutral and provider behavior behind adapters. Separate the latency-sensitive data plane from control-plane administration. Bound concurrency, queues, retries, bodies, buffers, and cache lifetimes; propagate deadlines and cancellation; close every listener, connection, timer, pool, and worker during shutdown.

Treat tenant identity as a data-boundary invariant. Never trust a client-supplied tenant identifier by itself. Avoid logging prompts, completions, credentials, authorization headers, and sensitive payloads. Store virtual-key hashes and protect provider credentials with authenticated encryption when those capabilities are introduced.

## Verification

Use the narrowest test that proves a behavior, then test module boundaries. Review every implementation for requirements, security, concurrency, resource lifecycle, and performance effects. Report exact commands and actual results. Treat 5,000 RPS and p95 gateway overhead below 5 ms as unverified benchmark objectives; never fabricate or imply test or benchmark success.
