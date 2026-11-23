# Proposal

## Why

M3 proves the non-streaming boundary, but a client must wait for the whole completion and the adapter seam offers no way to cancel or observe incremental output. M4 adds the first streaming slice so the gateway can deliver tokens incrementally, propagate client aborts and deadlines through the adapter boundary, and release every resource on success, failure, timeout, and disconnect without adding routing, live providers, or persistence.

## What Changes

- **BREAKING** for the strict M3 subset: `POST /v1/chat/completions` now accepts `stream: true`. Omitted or `false` keeps the M3 JSON behavior.
- Add optional `stream_options` containing only `include_usage` (boolean, default `false`), accepted only when `stream` is `true`.
- Emit OpenAI-shaped SSE chunks (`text/event-stream`, `data: <json>\n\n`, terminal `data: [DONE]\n\n`): content deltas, a finish chunk, and an optional final usage chunk.
- Frame failures that occur after response headers as one fixed safe `data: {"error": ...}` frame, then close without `[DONE]`; failures before commit keep the existing status mapping.
- Add a streaming adapter operation with normalized event ordering, plus a cancellation signal on every invocation.
- Enforce a finite request deadline from `REQUEST_TIMEOUT_MS` (default 30000 ms, allowed 1–300000), aborting adapter work when it expires.
- Bound streamed content to 8192 UTF-8 bytes, one in-flight event under backpressure, 64 active streams per instance, and the existing 65,536-byte request limit.
- Cancel adapters and release admission permits on client disconnect, deadline, adapter failure, serialization failure, and shutdown; abort active streams during bounded graceful shutdown.
- Extend the deterministic mock with a timer-free streaming path.
- Exclude live providers, routing, retries/fallback, authentication, quotas, persistence, telemetry, caching, guardrails, and benchmarks.

Proposed defaults for review: `include_usage` defaults to false; mid-stream errors use a `data:` error frame; aborted streams report no fabricated usage; one optional `signal` carries cancellation and the deadline is enforced at the HTTP boundary.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openai-chat-completions`: streaming subset, SSE framing, usage selection, mid-stream errors, bounds, cancellation.
- `provider-neutral-contracts`: streaming adapter operation, event ordering, cancellation signal, partial-usage semantics.
- `deterministic-mock-provider`: timer-free streaming behavior.
- `runtime-configuration`: `REQUEST_TIMEOUT_MS` validation and default.
- `service-lifecycle`: shutdown aborts active streams within the grace period.

## Impact

- Code: `src/http/chat-completions.ts` (or a focused streaming module), `src/domain/provider-adapter.ts`, `src/domain/provider-contracts.ts` (sequence validation), `src/adapters/mock-provider.ts`, `src/config.ts`, `src/server.ts`, `src/app.ts`, tests and fixtures, `README.md`.
- API: same endpoint; `stream: true`, `stream_options.include_usage`; new SSE response and mid-stream error frame.
- Dependencies: none; no client, worker, queue, or network path is added.
- Requirements: FR-006, NFR-002, NFR-003, NFR-005, SEC-001, TEST-001; FR-001 and NFR-004 remain applicable. No throughput or latency claim is made.
