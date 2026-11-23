# Design

## Context

See [proposal.md](proposal.md) for motivation and [the capability spec](specs/openai-chat-completions/spec.md) for observable behavior. `src/app.ts` currently creates Fastify with logging disabled and registers only `/health`. `src/server.ts` owns startup and bounded signal shutdown. `src/domain/provider-contracts.ts` validates and freezes neutral requests/responses; `ProviderAdapter.generate` accepts a request plus unified deployment. `createMockProvider` validates configured immediate success/error/timeout outcomes and needs no resources to close.

The M1/M2 tasks are complete but unarchived, and the main-spec inventory is empty. This proposal builds on their existing code and change specs without accepting or archiving them implicitly. The user selected the strict text-only chat subset during planning. All values and limits below are proposed defaults for review; no implementation or new dependencies are authorized by this document.

## Goals / Non-Goals

**Goals:** Keep compatibility translation at the HTTP edge, make each failure class testable, and bound accepted bodies, generated responses, and active adapter work with explicit constants.

**Non-Goals:** Change neutral contract types, add actual upstream timeout/cancellation machinery, measure input tokens, implement context eligibility/routing, or introduce operator configuration for mock behaviors. The process serves synthetic completions until a later live-provider change.

## Decisions

### Isolate the wire contract at the HTTP boundary

Add `src/http/chat-completions.ts` to own strict parsing, neutral translation, output checks, and envelope construction. Add `src/http/proxy-errors.ts` for the closed error table and safe envelopes. Keep OpenAI names and HTTP statuses outside `src/domain/` and `src/adapters/`. Reuse existing neutral constructors rather than duplicating their invariants.

Use explicit object/array/type/allowlist checks before neutral construction. Never coerce, trim submitted text, or silently remove unknown keys. Do not serialize arbitrary invalid keys into diagnostics. A framework schema using default coercion/removal behavior could accept a wider subset than specified; explicit validation makes this small surface easier to audit without a new schema dependency.

The parser returns the neutral request after matching `model` exactly to `mock-chat`; `stream` is an edge-only control. Validate full request shape before unknown-model classification. Map any structural/content/output-limit violation to 400, and only an otherwise valid unsupported model to 404. All validation errors use param null except the fixed model error. This avoids exposing untrusted field names and avoids defining unstable first-error ordering.

### Compose one fixed target using existing domain values

Add `src/mock-chat.ts` to construct the immutable deployment and default adapter at application creation. Use deploymentId `mock-chat-deployment`, adapterId `mock`, providerModelId `mock-chat-model`, capability `generation`, contextWindowTokens 8192, and zero USD rates in existing micros-per-million units. These are synthetic descriptor facts, not model eligibility or pricing enforcement.

Extend `createApp` with an optional adapter dependency for tests while preserving `createApp()` as the production path. The deployment and public alias remain fixed even with a supplied adapter. Dependencies are per application; no global mutable adapter registry. Production uses existing `createMockProvider` with the exact synthetic output in the spec. Client requests cannot choose adapter outcomes. This enables recording adapters, held promises, and invalid-output doubles in HTTP tests without introducing operator APIs or routing.

A registry, model catalog service, or provider SDK would expand M3 into later milestones. Do not add one. No environment variables or package changes are needed.

### Normalize framework failures inside an encapsulated route scope

Register the proxy in a Fastify child plugin with its own content handling and error handler. Preserve root health behavior and existing unknown-route behavior. Accept JSON with optional UTF-8 charset, reject unsupported encodings/charsets before parsing, and set the route body limit to 65,536 bytes. Use bounded framework body accumulation, including streamed requests without content length; do not accumulate request chunks in a new buffer.

The child error handler translates malformed/empty JSON, body-limit errors, and media-type errors using framework error codes, without returning framework messages. Explicitly cover missing content type and content encoding in request hooks. Scope all POST endpoint failures, including parser failures, to the same safe envelope. Framework default error bodies must not escape this route.

### Use fixed messages and category-only error mapping

Use the status/type/code table in the spec and the fixed messages below. Never forward even a normalized error's message to the client; M2 validates its shape but cannot prove the text is safe. Unknown thrown values become internal errors. Revalidate successful adapter output before wire translation; validation/overflow failures become invalid-provider-response errors.

| Code | Fixed message |
| --- | --- |
| invalid_request | Invalid request. |
| model_not_found | Model not found. |
| request_too_large | Request body too large. |
| unsupported_media_type | Unsupported media type. |
| upstream_timeout | Upstream request timed out. |
| upstream_rate_limited | Upstream rate limit exceeded. |
| upstream_unavailable | Upstream unavailable. |
| upstream_error | Upstream request failed. |
| invalid_provider_response | Invalid upstream response. |
| internal_error | Internal server error. |
| gateway_busy | Gateway is busy. |

No retry header or retryable field is exposed, and no retry is attempted. A normalized invalid-request category maps to 400 even after an otherwise valid HTTP request; the gateway does not reinterpret the adapter taxonomy.

### Construct one bounded completion

Generate a `chatcmpl-` id using Node's UUID facility and `created` using integer Unix seconds, only at the HTTP edge. Tests assert id shape/uniqueness and a timestamp range rather than snapshotting volatile values. Return only the specified envelope and choice fields; optional OpenAI fields outside the chosen subset are omitted.

Before cloning a returned response through the neutral validator, check that it has string content of at most 8192 UTF-8 bytes. Validate with `createGenerationResponse`, then apply edge-specific usage checks: cache-read <= input and input + output is safe. Treat input as including cache-read for this wire view; do not alter M2 types or silently repair invalid usage. The default usage numbers are fixture data, not counts derived from message strings.

Construct and serialize the bounded envelope once, check its UTF-8 byte length against 65,536, and send it as JSON without reserializing or schema-driven field removal. Eight KiB of text limits even worst-case JSON escaping to a small finite allocation; the final check makes the total bound explicit. Reject overflow, never truncate. Arbitrary oversized objects from malicious in-process code are outside this guarantee; this boundary neither logs nor serializes them.

### Bound active adapter work without a queue

Maintain one counter per application with capacity 64. After parsing/validation and immediately before `generate`, acquire a permit synchronously or reject with the fixed busy error. Release it in `finally` after generation, output validation, and serialization. A rejected request never enters a retry or wait queue. Existing logger-disabled behavior remains in place.

This local admission cap implements the applicable NFR-001 bound; it is not the distributed tenant limiter planned for M8. It bounds active generation work, not all inbound sockets or transport buffers. Introducing a generalized semaphore, dynamic tuning, or Redis is unnecessary for this slice. Real upstream deadlines and client abort propagation require the M4 invocation-contract change. M3 production uses only the immediate, resource-free mock and creates no timers, pools, workers, or outbound connections.

### Verify fixtures and lifecycle at module boundaries

Create static JSON fixtures under `test/fixtures/chat-completions/` during implementation. Include the exact default request and expected response with only id/created normalized in assertions. Add the mixed-role request, all finish reasons, cached usage, and a table of rejected requests and safe error envelopes. The source for wire vocabulary is the [official Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), consulted 2026-11-23; our stricter subset and all gateway codes/limits are defined locally by this change.

Use focused helper tests for validation/translation and Fastify injection for the composed boundary. Recording doubles prove one neutral invocation; held promises prove saturation/release. Invalid-output doubles prove runtime response validation. Test actual UTF-8 byte limits using Unicode and escaping. Use a real local Node HTTP request for a chunked oversized body, since injection alone does not prove transport enforcement. Close every app, listener, client, and held promise in test cleanup.

Extend built-process smoke coverage to call the new endpoint with no credentials, check health, and exit on each supported signal. Existing lifecycle tests remain the evidence for active-request draining. Inspect captured stdout/stderr and application logs across sensitive request/error paths. Run the existing Bun quality loop and strict OpenSpec validation; do not add a load harness or claim performance targets.

## Risks / Trade-offs

- [Clients expect the full OpenAI API] → Document the exact supported fields and reject every unsupported option, including `max_tokens`, developer messages, and `n: 1`.
- [Framework validation defaults change behavior or leak values] → Use explicit boundary checks, scoped errors, and malformed/media-type/overflow fixtures.
- [Mock behavior looks like real inference or usage measurement] → Use a conspicuous public mock alias and document fixed synthetic output/usage.
- [Output validation creates large copies] → Check content byte length before neutral construction and serialize only the small selected envelope.
- [Test doubles never settle] → Explicitly settle held promises in cleanup. Do not infer M4 cancellation support from M3 saturation tests.
- [The local counter is mistaken for a total memory bound] → State its limited scope and retain separate byte limits; overall adverse-network/streaming memory evidence belongs to later milestones.

## Migration Plan

Implement the error/translation helpers first, then fixed composition and route integration, then compatibility/resource/lifecycle coverage. Existing no-argument application construction and health responses remain valid. Rollback removes the proxy plugin, composition module, and associated tests; no persisted data, dependencies, environment settings, or infrastructure changes need migration. Review and verify implementation before acceptance or archive.
