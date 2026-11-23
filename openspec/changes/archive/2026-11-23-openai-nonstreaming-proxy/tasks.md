# Tasks

## 1. HTTP Translation and Safe Errors

- [x] 1.1 Add `src/http/proxy-errors.ts` with the spec's closed status/type/code mapping and design's fixed messages; verify focused Bun tests cover every neutral category, both retryability values where valid, unknown exceptions, every boundary error, exact envelope fields, and diagnostic secrecy.
- [x] 1.2 Add strict request parsing and neutral translation in `src/http/chat-completions.ts`; add accepted/rejected JSON fixtures under `test/fixtures/chat-completions/` and focused Bun tests for required fields, exact model matching, mixed-role ordering/whitespace/Unicode, 1/128/129 messages, unknown root/message fields, unsupported controls, explicit nulls, coercion rejection, omitted options, and output limits 1/8192/8193.
- [x] 1.3 Add validated response translation and bounded serialization in the HTTP module; verify focused Bun tests cover all finish reasons, empty text, exact envelope fields, UUID-shaped unique ids and timestamp ranges, cached usage mapping, invalid neutral outputs, unsafe token sums, cache counts above input, and 8192/8193 UTF-8-byte content with Unicode and JSON escaping within the 65,536-byte serialized bound.

## 2. Fixed Mock Composition and HTTP Integration

- [x] 2.1 Add `src/mock-chat.ts` using existing deployment/mock constructors and the exact synthetic descriptor/output from design; verify focused Bun tests assert the fixed deployment, repeated default output, no credentials/network/timers, and synthetic usage independent of submitted messages.
- [x] 2.2 Register an encapsulated proxy plugin through `src/app.ts`, preserving `createApp()` and adding an optional per-app adapter test dependency; verify Fastify injection passes the default request/response fixture, accepts no credentials, preserves health and unrelated-route behavior, forwards exactly one neutral invocation with the fixed deployment, omits absent output limits, and never invokes an adapter for invalid or unknown-model requests.
- [x] 2.3 Enforce route JSON/media/encoding checks and 65,536-byte body accumulation with safe scoped framework errors; verify injection tests cover empty/malformed JSON, unsupported or missing content type, UTF-8 acceptance, non-UTF-8 charset and compressed encoding rejection, and exact/over-limit bodies, then verify chunked body overflow without content length using a real local Node HTTP connection with full cleanup.
- [x] 2.4 Add the per-application cap of 64 active calls with immediate rejection and `finally` release, without timers, queues, retries, or globals; verify held-promise HTTP tests cover the 65th request, independent health, capacity recovery after success/rejection/invalid output, independent application counters, exactly one invocation on failure, and zero invocations for busy requests, settling every held promise during cleanup.
- [x] 2.5 Add HTTP compatibility/error fixtures for all mapped normalized failures, unexpected exceptions, and invalid adapter results; verify exact status/envelope fields and fixed messages, no retry headers/provider details, and captured log/output secrecy for sensitive content, authorization headers, arbitrary unknown keys, malformed bodies, overflow, and raw exceptions across success and failure paths.
- [x] 2.6 Document the supported fields, `mock-chat` alias, synthetic response/usage, all byte/admission limits, strict unsupported-field policy, error table, exclusions, and a runnable curl example in `README.md`; verify the example against the composed app and cross-check the documented surface against the approved capability spec.

## 3. Integrated Verification

- [x] 3.1 Extend built-process tests to call the default proxy fixture before SIGINT and SIGTERM; run the focused process/lifecycle suites to prove health remains exact, the built Node.js entry point serves the mock, signal shutdown closes the listener with zero exit status, and stdout/stderr omit sensitive sentinels, with child/socket cleanup on every path.
- [x] 3.2 Run `bun run check` and `openspec validate openai-nonstreaming-proxy --strict`; review the complete change against FR-005, neutral boundaries, SEC-001, resource bounds, concurrency, shutdown, and excluded M4+ scope, resolve findings, and report exact commands and actual results without claiming benchmark objectives are achieved.

## Workflow follow-up

- Obtain implementation approval after the planning artifacts are presented. During apply, respect the repository's one-task-at-a-time protocol and the retained source requirement for approval before advancing tasks unless the user explicitly authorizes a broader sequence.
- Review implementation and verification evidence before accepting the change. Acceptance/archive of predecessor changes remains separate work.
- Archive only after implementation, verification, and review are approved.
