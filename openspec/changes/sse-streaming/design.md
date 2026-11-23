# Design

## Context

M3 parses the strict request subset, enforces media/body limits, acquires one of 64 per-application permits, invokes `ProviderAdapter.generate`, and serializes one JSON completion in `src/http/chat-completions.ts`. `ProviderInvocation` currently carries only the normalized request and unified deployment. `NormalizedStreamEvent` exists as a validated vocabulary but has no transport. `createMockProvider` is immediate and timer-free. `src/server.ts` calls `app.close()` inside a `SHUTDOWN_GRACE_MS` race; Fastify `preClose` hooks run before the listener closes. Startup configuration is validated in `loadRuntimeConfig`. See [proposal.md](proposal.md) for motivation and the [delta specs](specs/) for behavior.

## Goals / Non-Goals

**Goals:**

- Deliver SSE incrementally with at most one frame in flight and bounded memory.
- Propagate client disconnect, deadline, and shutdown through one adapter cancellation signal.
- Preserve M3 status and error mapping before the response commits, and use one safe error frame afterward.
- Keep streaming deterministic and testable without live providers, extra timers, or flaky sleeps.

**Non-Goals:**

- Live providers, routing, retries, fallback, accounting, persistence, or telemetry.
- Resumable streams, multiple choices, tool calls, heartbeats, compression, or HTTP/2 push.
- Changing the non-streaming wire response.

## Decisions

### Split SSE framing from request handling

Add `src/http/sse.ts` for frame construction, header commitment, backpressure-aware writes, and the event-to-frame state machine. Keep parsing, validation, admission, and dispatch in `src/http/chat-completions.ts`, delegating only when `stream: true`. Reuse `proxy-errors.ts` for mapping.

A single larger HTTP module was rejected because framing, backpressure, and error commitment are independently testable and significantly longer than request validation.

### Add a second, optional adapter operation

Extend `ProviderAdapter` with `stream?(invocation): AsyncIterable<NormalizedStreamEvent>` and add `signal?: AbortSignal` to `ProviderInvocation`. `generate` remains unchanged. The fixed mock implements both; an adapter without `stream` yields `internal_error` for streaming requests.

Returning a union from `generate` was rejected because callers must discriminate the result and because streaming has a different lifetime, cancellation, and cleanup profile. Requiring `stream` on every adapter was rejected to keep M2/M3 test doubles and the contract suite valid.

### Enforce event ordering with a shared validator

Add `createStreamSequenceValidator` to the provider-contracts module. It validates each event with `createStreamEvent`, enforces content deltas → at most one usage → exactly one completion, rejects anything after completion, exposes the held usage, and requires completion on finalization. The HTTP boundary uses it while framing; the adapter contract suite uses it to prove adapter streams.

Duplicating ordering rules inside the HTTP writer was rejected because adapter tests and the route would drift. A separate module for the validator was rejected because the event vocabulary and its ordering are one contract.

### Commit the response on the first frame

Acquire the permit, create the iterator, and pull events until the first wire frame is ready. Commit headers with `reply.hijack()` and `writeHead(200, …)` only immediately before writing that first frame; a usage event alone writes no frame. A failure before that point uses the existing HTTP status mapping; a failure afterward emits one error frame and closes without `[DONE]`.

Committing headers immediately was rejected because an immediate timeout or malformed adapter output could no longer return 504/502, and clients would see a truncated 200 stream for a failure that never produced content.

### Hold at most one usage event until completion

Content deltas are framed immediately. A usage event is validated and held; on completion the writer emits the finish chunk, then the usage chunk when `include_usage` is true, then `[DONE]`. When `include_usage` is false the validated usage is discarded. A second usage event, or any event after completion, is an invalid sequence.

Emitting usage in adapter order was rejected because OpenAI places the usage chunk after the finish chunk. Buffering all events was rejected because it would defeat streaming and break the memory bound.

### Use raw writes with explicit backpressure

Call `reply.hijack()`, then write headers and frames through `reply.raw`. If `write()` returns false, await `drain` raced against close and abort before reading the next adapter event. Only one frame is in flight, and no queue is introduced.

`Readable.from(iterator).pipe(reply.raw)` was rejected because late error frames, header timing, and cancellation cleanup become implicit and harder to test. Holding one frame in memory is the bound; a slow consumer pauses the iterator rather than growing a buffer.

### One controller and one deadline timer per request

Each streaming request gets one `AbortController` and one `REQUEST_TIMEOUT_MS` timer created after admission. The timer is `unref()`ed and cleared in `finally`. Client `close`, deadline expiry, shutdown, and iterator failure abort the controller and call `iterator.return()`. The HTTP layer records the cause so it can choose the timeout error frame, the shutdown error frame, or no frame for a vanished client.

Absolute deadlines inside the invocation were rejected because adapters would need clocks and duplicate timers. Carrying multiple cause flags in the neutral invocation was rejected because adapters only need cancellation, not gateway policy.

### Per-application stream registry for admission and shutdown

Reuse the existing per-application active counter: a streaming invocation holds its permit for the iterator lifetime. Add a per-application registry mapping each active stream to its controller and a completion promise. The route registers on commit and unregisters in `finally`.

The plugin registers a `preClose` hook that aborts every active controller and awaits `Promise.allSettled` of the completion promises. This lets `app.close()` finish inside the existing `SHUTDOWN_GRACE_MS` race; if settlement still exceeds the grace period, the existing shutdown timeout path exits non-zero.

A global registry was rejected because per-application state already isolates tests and avoids cross-instance interference.

### Deterministic, timer-free mock streaming

For a success configuration, split the configured content at the last space at or before the midpoint into at most two deltas, then emit usage and completion. The default `Mock response.` becomes `Mock ` and `response.`. Check the signal before each yield. Provider-error and timeout configurations fail before the first delta.

One delta was rejected because the default fixture must prove incremental framing. Configurable delays or sleeps were rejected because they introduce timers and flakiness; mid-stream failures, hangs, and slow consumers use controllable test doubles instead.

### Add a validated request deadline setting

Add `REQUEST_TIMEOUT_MS` to `loadRuntimeConfig`, default `30000`, integer `1`–`300000`, validated with the existing diagnostics. `createApp` accepts an optional `requestTimeoutMs` for tests and production composition; `startServer` passes the configured value. The deadline applies to every streaming chat completion request; the non-streaming path stays timer-free as specified.

A hard-coded constant was rejected because operators need to tune the bound. A client-supplied deadline header was rejected as unapproved surface.

### Frame errors with the existing error table

Reuse `ProxyError` codes, fixed messages, and types. A mid-stream timeout uses `upstream_timeout`, shutdown uses `internal_error`, and invalid adapter output or sequence uses `invalid_provider_response`. The frame is `data: {"error":{...}}\n\n`, then the response closes without `[DONE]`.

Provider diagnostics, exception messages, and submitted values stay out of frames exactly as in the non-streaming path.

## Risks / Trade-offs

- [Raw writes bypass Fastify reply handling] → Use `reply.hijack()`, remove close listeners in `finally`, and cover success, abort, and error paths with real HTTP tests.
- [Open streams hold sockets and permits] → The 64-permit cap, finite deadline, client close handling, and shutdown registry bound them.
- [Content cannot be retracted after an overflow or mid-stream failure] → Emit the safe error frame and omit `[DONE]`; document that a missing `[DONE]` means an incomplete stream.
- [Holding usage delays the final chunk] → Hold at most one small immutable value, not content.
- [Proxies may buffer SSE] → Send no compression and document deployment buffering; heartbeats are deferred.
- [One timer per active stream] → Bound by 64, `unref()`ed, and cleared on every path.
- [`inject` may buffer SSE] → Use real local HTTP for incremental delivery, backpressure, disconnect, and shutdown tests.

## Migration Plan

The non-streaming path is unchanged when `stream` is omitted or false. Rollback removes the SSE module, the optional adapter method, the per-application stream registry, and `REQUEST_TIMEOUT_MS`; existing M3 fixtures and behavior remain valid. No dependencies, persisted data, or infrastructure changes are required.

## Open Questions

- Heartbeat comments for idle streams are deferred until live providers can introduce long gaps; the deterministic mock never idles.
- Proxy-specific and HTTP/2 buffering behavior belongs to deployment validation after M4.
