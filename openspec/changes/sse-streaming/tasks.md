# Tasks

## 1. Neutral Streaming Seam and Configuration

- [x] 1.1 Extend `ProviderInvocation` with an optional `signal: AbortSignal` and `ProviderAdapter` with an optional `stream` operation returning `AsyncIterable<NormalizedStreamEvent>`; verify focused contract tests cover ordering, duplicate usage, missing completion, and provider-specific event rejection, and that existing `generate` contract tests still pass.
- [x] 1.2 Add a reusable stream-sequence validator/state machine for adapter contract tests and the HTTP boundary; verify it accepts content deltas plus one usage plus completion and rejects duplicate usage, events after completion, and exhausted streams without completion.
- [x] 1.3 Add deterministic streaming to `createMockProvider` by splitting configured success content at the last space at or before the midpoint, then emitting usage and completion; verify default content becomes `Mock ` and `response.`, error/timeout configurations fail before the first delta, and abort stops iteration without completion.
- [x] 1.4 Add `REQUEST_TIMEOUT_MS` to `loadRuntimeConfig` with default `30000` and bounds `1`–`300000`; verify default, boundary, and invalid-value tests, and that startup fails before listening on invalid input.

## 2. SSE HTTP Boundary

- [x] 2.1 Accept `stream: true` and optional `stream_options.include_usage` in request parsing while rejecting `stream_options` without streaming, unknown keys, non-boolean values, and explicit nulls; verify parser tests cover every accepted and rejected shape and that `stream` never enters the neutral request.
- [x] 2.2 Add `src/http/sse.ts` with header commitment, `data: <json>\n\n` frame serialization, chunk shapes, stable id/created/model, finish chunk, usage chunk, and `[DONE]`; verify focused tests assert exact frame bytes and ordering, including empty content and all finish reasons.
- [x] 2.3 Implement the event-to-frame state machine with delayed header commitment until the first wire frame, single held usage event, `include_usage` selection, and mid-stream `invalid_provider_response`/`upstream_timeout`/`internal_error` error frames; verify failures before commit keep the non-streaming status table and failures after commit emit exactly one safe frame without `[DONE]`.
- [x] 2.4 Enforce backpressure and bounds by writing one frame at a time, awaiting drain or close before the next iterator read, limiting accumulated content to 8192 UTF-8 bytes and each frame to 65,536 bytes; verify slow-consumer, exact-boundary, and overflow tests using a real local HTTP connection.
- [x] 2.5 Integrate streaming into the route: hold the existing 64-permit admission for the iterator lifetime, create one `AbortController` and `REQUEST_TIMEOUT_MS` timer per request, abort on client close/deadline/iterator failure, close the iterator, release the permit, and clear the timer; verify real-HTTP tests cover saturation, capacity recovery, client abort, deadline, and timer cleanup.
- [x] 2.6 Register a per-application active-stream registry and `preClose` hook that aborts controllers and awaits stream settlement so `app.close()` completes within `SHUTDOWN_GRACE_MS`; verify built-process tests receive a partial stream, send SIGINT and SIGTERM, observe no `[DONE]`, zero exit status, closed listener, and no leaked sockets.
- [x] 2.7 Document the streaming request fields, headers, chunk shapes, usage selection, error frame, bounds, deadline, curl example, and exclusions in `README.md`; verify the documented example against the composed built app and cross-check every claim against the delta specs.

## 3. Integrated Verification

- [x] 3.1 Run a real-HTTP streaming matrix covering incremental delivery, slow consumer backpressure, client disconnect, deadline, adapter failure after content, invalid usage/sequence, 64-stream saturation, independent health, and sensitive-sentinel absence in logs and frames; verify every path settles and leaves no open handles, timers, or unhandled rejections.
- [x] 3.2 Run `bun run check` and `openspec validate sse-streaming --strict`; review the change against FR-006, NFR-002, NFR-003, NFR-005, SEC-001, neutral boundaries, and excluded M5+ scope, resolve findings, and report exact commands and actual results without claiming throughput or latency objectives.

## Workflow follow-up

- Review the implementation and evidence before accepting the change.
- Archive the change after acceptance and update the roadmap implementation status.
