# openai-chat-completions Specification

## Purpose

Define a bounded, explicitly limited OpenAI-compatible non-streaming chat endpoint that translates HTTP requests and responses through the provider-neutral adapter boundary without live-provider access.

## Requirements

### Requirement: Supported endpoint and model

The service SHALL expose `POST /v1/chat/completions` without requiring authentication in M3. It SHALL accept only the exact model alias `mock-chat`, mapped to one fixed mock deployment. It SHALL return HTTP 404 with code `model_not_found` for any other non-blank string model. Model discovery and other generation endpoints SHALL remain unavailable.

#### Scenario: Fixed model is available

- **WHEN** a client posts a valid request for `mock-chat` without an authorization header
- **THEN** the request succeeds through the fixed mock adapter without credentials or network access

#### Scenario: Unknown model

- **WHEN** an otherwise valid request specifies model `other-model`
- **THEN** it returns 404 with code `model_not_found`, param `model`, and no adapter invocation

### Requirement: Strict request subset

The request SHALL be a JSON object with required `model` and `messages`, and only optional `max_completion_tokens`, `stream`, and `stream_options`. Model SHALL be a non-blank string without coercion or trimming for alias matching. Messages SHALL contain 1–128 objects with only `role` and `content`. Roles SHALL be `system`, `user`, or `assistant`; content SHALL be a non-blank string preserved exactly. `stream_options` SHALL be an object containing only `include_usage`, a boolean, and SHALL be accepted only when `stream` is exactly `true`. Unknown fields at either level SHALL be rejected.

#### Scenario: Ordered text messages are preserved

- **WHEN** a request supplies system, user, and assistant messages containing surrounding whitespace and Unicode text
- **THEN** translation preserves their roles, order, and exact content

#### Scenario: Invalid or unsupported request shape

- **WHEN** a body is null, an array, or a scalar; lacks a required field; contains empty or more than 128 messages; has a null/blank/non-string content; uses a tool/developer role or content array; or contains any extra root/message field
- **THEN** it returns 400 with code `invalid_request` and no adapter invocation

#### Scenario: Unsupported controls are rejected

- **WHEN** a request includes `max_tokens`, `temperature`, `n`, `tools`, `response_format`, or a client-supplied tenant field
- **THEN** it returns 400 with code `invalid_request` without silently dropping the field

#### Scenario: Stream options require streaming

- **WHEN** a request supplies `stream_options` while `stream` is omitted or `false`, or supplies an unknown `stream_options` field or a non-boolean `include_usage`
- **THEN** it returns 400 with code `invalid_request` and no adapter invocation

### Requirement: Non-streaming and output limit controls

`stream`, when present, SHALL be a boolean. Omitted or `false` SHALL select the non-streaming JSON response; `true` SHALL select the SSE response. `max_completion_tokens` SHALL be an integer between 1 and 8192 inclusive. Explicit nulls and coerced values SHALL be rejected. Omitted output limit SHALL remain absent in the neutral request. A supplied output limit SHALL translate to neutral `maxOutputTokens`.

#### Scenario: Accepted optional controls

- **WHEN** a valid request omits optional fields or supplies `stream: false` and an integer output limit of 1 or 8192
- **THEN** it succeeds with JSON and only the supplied output limit appears in the neutral invocation

#### Scenario: Invalid optional controls

- **WHEN** stream is null or a string, or the output limit is null, zero, negative, fractional, a string, or greater than 8192
- **THEN** it returns 400 with code `invalid_request` and no adapter invocation

#### Scenario: Streaming is selected

- **WHEN** a valid request supplies `stream: true`
- **THEN** the endpoint returns an SSE response and `stream` does not enter the neutral request

### Requirement: Neutral adapter forwarding

Each admitted valid request SHALL invoke the configured adapter exactly once with a validated neutral request and the fixed unified deployment. Wire fields `model`, `stream`, and `max_completion_tokens` SHALL NOT enter neutral contracts. There SHALL be no retries, fallback, dynamic deployment selection, or provider-specific payload escape hatch.

#### Scenario: Invocation is observed

- **WHEN** a valid HTTP request is sent with an output limit of 16
- **THEN** the adapter receives only ordered neutral messages, `maxOutputTokens: 16`, and the fixed deployment, and its invocation count is one

### Requirement: Completion response envelope

A successful response SHALL be HTTP 200 JSON with only `id`, `object`, `created`, `model`, `choices`, and `usage` at the root. Id SHALL be a unique `chatcmpl-`-prefixed identifier and created SHALL be integer Unix seconds. Object SHALL be `chat.completion`, model SHALL be `mock-chat`, and choices SHALL contain exactly one item with index 0, assistant text, and the translated finish reason.

#### Scenario: Completion fields are translated

- **WHEN** the adapter returns valid text with finish reason `stop`, `length`, or `content_filter`
- **THEN** choices is exactly `[{"index":0,"message":{"role":"assistant","content":"<adapter text>"},"finish_reason":"<same reason>"}]`, including empty text when returned
- **AND** no deployment identifier, provider model identifier, adapter metadata, or raw provider object is exposed

#### Scenario: Response identifiers are per completion

- **WHEN** two requests complete successfully
- **THEN** their ids differ and their created values are valid integer Unix timestamps

### Requirement: Usage translation

Usage SHALL contain `prompt_tokens`, `completion_tokens`, `total_tokens`, and `prompt_tokens_details` with only `cached_tokens`. They SHALL map to neutral input, output, input plus output, and cache-read counts respectively. Input counts SHALL include cached input for this endpoint; cached counts MUST NOT exceed input. All counts and the sum SHALL be non-negative safe integers. Invalid usage SHALL produce 502 `invalid_provider_response`.

#### Scenario: Cached usage is not counted twice

- **WHEN** neutral usage is input 10, output 3, and cache-read 4
- **THEN** wire usage is `{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13,"prompt_tokens_details":{"cached_tokens":4}}`

#### Scenario: Usage cannot be represented safely

- **WHEN** output has missing/negative/fractional counts, cache-read exceeds input, or input plus output exceeds the safe integer range
- **THEN** it returns 502 with code `invalid_provider_response` without exposing the rejected output

### Requirement: Deterministic default composition

The default process SHALL serve the existing deterministic mock with content `Mock response.`, finish reason `stop`, and synthetic usage input 1, output 1, cache-read 0. The response SHALL be independent of submitted text and SHALL NOT claim actual token measurement. HTTP compatibility tests SHALL exercise alternate normalized outcomes without exposing client-selectable mock controls.

#### Scenario: Default fixture succeeds

- **WHEN** the default process receives `{"model":"mock-chat","messages":[{"role":"user","content":"Hello"}],"max_completion_tokens":16,"stream":false}`
- **THEN** it returns the defined completion envelope with content `Mock response.`, finish reason `stop`, and usage prompt 1, completion 1, total 2, cached 0

### Requirement: Safe error envelope

Every error generated for POST requests to this endpoint SHALL be JSON with exactly `{"error":{"message":"<fixed safe message>","type":"<type>","param":null,"code":"<code>"}}`, except `model_not_found` SHALL use param `model`. Messages SHALL be fixed by error code. Diagnostics, submitted values, arbitrary field names, exception messages, stacks, provider payloads, and credentials SHALL NOT appear in errors.

#### Scenario: Sensitive failure data exists

- **WHEN** malformed input, an arbitrary unknown field name, or an adapter exception contains a unique sensitive sentinel
- **THEN** the HTTP error contains none of that sentinel or the exception diagnostics and uses only the defined error fields

### Requirement: Stable HTTP error classification

Request validation SHALL return 400; unsupported media type SHALL return 415; body overflow SHALL return 413; unknown model SHALL return 404. Neutral failures SHALL map by category regardless of retryability. Unknown exceptions SHALL return 500 `internal_error`, and invalid adapter results SHALL return 502 `invalid_provider_response`. The endpoint SHALL emit no retry instructions or extra provider-derived error fields.

#### Scenario: Boundary failures are classified

- **WHEN** a request fails boundary validation
- **THEN** the status, type, and code match this table

| Failure | HTTP | Type | Code |
| --- | --- | --- | --- |
| Invalid shape, unsupported field, empty body, malformed JSON | 400 | invalid_request_error | invalid_request |
| Unknown non-blank model | 404 | invalid_request_error | model_not_found |
| Request body overflow | 413 | invalid_request_error | request_too_large |
| Missing or unsupported content type | 415 | invalid_request_error | unsupported_media_type |

#### Scenario: Adapter failures are classified

- **WHEN** the adapter throws a normalized error or an unexpected exception, or returns invalid output
- **THEN** the status, type, and code match this table, independent of its diagnostic message or retryable flag

| Outcome | HTTP | Type | Code |
| --- | --- | --- | --- |
| invalid_request | 400 | invalid_request_error | invalid_request |
| timeout | 504 | server_error | upstream_timeout |
| rate_limited | 429 | rate_limit_error | upstream_rate_limited |
| provider_unavailable | 503 | server_error | upstream_unavailable |
| provider_error | 502 | server_error | upstream_error |
| Invalid adapter result | 502 | server_error | invalid_provider_response |
| Unexpected thrown exception | 500 | server_error | internal_error |

### Requirement: Request and response byte bounds

The endpoint SHALL accept only `application/json` with optional UTF-8 charset and uncompressed bodies up to 65,536 bytes inclusive. Other media types, non-UTF-8 charsets, or non-identity content encodings SHALL return 415. Non-streaming response content SHALL be at most 8192 UTF-8 bytes and the serialized success body SHALL be at most 65,536 UTF-8 bytes. Streaming assistant content SHALL total at most 8192 UTF-8 bytes across all deltas, and each serialized SSE frame SHALL be at most 65,536 UTF-8 bytes. Response overflow SHALL fail without truncation: 502 `invalid_provider_response` before commit, or an error frame after commit.

#### Scenario: Exact body boundary

- **WHEN** valid JSON with padding is exactly 65,536 bytes, or is 65,537 bytes with or without a content-length header
- **THEN** the exact-limit body is accepted and the oversized body returns 413 before adapter invocation

#### Scenario: Media type enforcement

- **WHEN** the request uses UTF-8 application/json, or instead uses text/plain, a missing content type, a non-UTF-8 charset, or gzip encoding
- **THEN** JSON is accepted and each unsupported representation returns 415 without adapter invocation

#### Scenario: Response bounds use encoded bytes

- **WHEN** non-streaming adapter text is exactly 8192 UTF-8 bytes, or exceeds it by one byte
- **THEN** the exact-limit result succeeds within the serialized bound and the oversized result returns 502 without truncation
- **AND** Unicode and JSON escaping are included in byte-boundary tests

#### Scenario: Streaming content bound

- **WHEN** accumulated streamed content reaches 8192 UTF-8 bytes, or the next delta would exceed it
- **THEN** the exact-limit content completes normally and the overflow ends the stream with `invalid_provider_response`, without `[DONE]` and without emitting the overflow delta

### Requirement: Bounded admission and cleanup

At most 64 adapter invocations SHALL be active per application instance, counting a streaming invocation for the full lifetime of its event iterator. An additional validated request SHALL fail immediately with 503 `gateway_busy` of type `server_error`; it SHALL NOT queue or invoke the adapter. Capacity SHALL be released on success, adapter rejection, invalid output, serialization failure, client abort, deadline, and shutdown. Health probes SHALL remain independent of this bound.

#### Scenario: Saturation and recovery

- **WHEN** 64 admitted invocations are held active and another valid request arrives
- **THEN** the additional request returns 503 `gateway_busy` without an invocation, while health returns 200
- **AND** completion or rejection of held invocations releases capacity for later requests

#### Scenario: Streaming saturation holds capacity

- **WHEN** admitted streaming responses remain open
- **THEN** each holds one permit for its lifetime, and aborting or completing a stream releases its permit for a later request

### Requirement: Sensitive data and lifecycle preservation

The proxy SHALL NOT log request/response content, headers, credentials, submitted values, or raw exceptions. It SHALL preserve health and graceful shutdown behavior and SHALL introduce no network clients, workers, or queues. A non-streaming response SHALL use no timer. A streaming response SHALL use at most one deadline timer per active stream and SHALL clear it on success, adapter failure, invalid output, client abort, deadline, and shutdown. The immediate default mock SHALL drain during shutdown; real upstream network deadlines remain future work.

#### Scenario: Sensitive paths remain quiet

- **WHEN** requests exercise success, validation failure, provider failure, unexpected exception, overflow, and streaming with sensitive sentinels in content and headers
- **THEN** captured logs contain none of the sensitive sentinels or raw exception data

#### Scenario: Production startup and shutdown include the proxy

- **WHEN** the built Node.js process serves a default completion and receives SIGINT or SIGTERM
- **THEN** health and completion behavior are correct, the listener closes within the configured grace period, and the process exits successfully

#### Scenario: Streaming cleanup releases timers

- **WHEN** a stream ends by completion, adapter error, client abort, deadline, or shutdown
- **THEN** its deadline timer is cleared and no work continues after the response is closed

### Requirement: SSE streaming framing

When `stream` is `true`, a successful response SHALL use HTTP 200 with `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache`, and no compression. Each frame SHALL be `data: <json>\n\n`; the terminal frame SHALL be `data: [DONE]\n\n`.

#### Scenario: Content streams incrementally

- **WHEN** the adapter yields multiple content deltas followed by completion
- **THEN** each content delta is written as its own SSE frame before the finish chunk, and concatenating the deltas reproduces the adapter content exactly

#### Scenario: Stream terminates with done

- **WHEN** the adapter completes successfully
- **THEN** exactly one finish chunk and one terminal `[DONE]` frame are emitted, in that order, and no frame follows `[DONE]`

### Requirement: SSE chunk shape and ordering

Each chunk SHALL use `object: chat.completion.chunk`, one shared `chatcmpl-` id, integer Unix-seconds `created`, and `model: mock-chat`. Content SHALL appear as `choices: [{"index":0,"delta":{"content":"<text>"},"finish_reason":null}]`, followed by exactly one finish chunk `choices: [{"index":0,"delta":{},"finish_reason":"<reason>"}]`, then optionally one usage chunk, then `[DONE]`. No deployment, provider, or adapter metadata SHALL appear.

#### Scenario: Stream identifiers are stable

- **WHEN** a streamed response contains several chunks
- **THEN** all chunks share one id, one created value, and the fixed model alias

#### Scenario: Finish chunk carries the reason

- **WHEN** the adapter completes with `stop`, `length`, or `content_filter`
- **THEN** exactly one finish chunk with an empty delta and the same finish reason precedes the usage or terminal frame

### Requirement: Streaming usage selection

When `stream_options.include_usage` is `true`, exactly one usage chunk with `choices: []` SHALL follow the finish chunk and precede `[DONE]`, using the non-streaming usage mapping and validation. When it is absent or `false`, no usage chunk SHALL be emitted; a present adapter usage event SHALL still be validated.

#### Scenario: Usage is requested

- **WHEN** a client sets `stream_options.include_usage` to `true` and the adapter emits valid usage before completion
- **THEN** one usage chunk with `choices: []` is emitted after the finish chunk and before `[DONE]`

#### Scenario: Usage is not requested

- **WHEN** `include_usage` is absent or `false`
- **THEN** no usage chunk is emitted, even when the adapter emits a usage event

### Requirement: Missing requested usage

If `include_usage` is `true` and the adapter completes without a usage event, the stream SHALL end with `invalid_provider_response` and no `[DONE]`.

#### Scenario: Requested usage is missing

- **WHEN** `include_usage` is `true` and the adapter completes without emitting usage
- **THEN** the stream ends with an `invalid_provider_response` error frame and no `[DONE]`

### Requirement: Mid-stream failure framing

A failure after the first SSE frame has been committed SHALL emit exactly one `data: {"error":{...}}\n\n` frame using the same fixed envelope, type, and code mapping as a non-streaming error, then close the response without `[DONE]`. The HTTP status SHALL remain 200. A failure before any frame is committed SHALL use the non-streaming HTTP status mapping instead. Error frames SHALL contain no exception messages, stacks, submitted values, provider payloads, or credentials.

#### Scenario: Adapter failure after content

- **WHEN** the adapter yields a content delta and then throws a normalized provider error
- **THEN** the client receives the content frame, one error frame with the mapped code and fixed message, and no `[DONE]`

#### Scenario: Deadline after content

- **WHEN** the request deadline expires after content has been streamed
- **THEN** the client receives one `upstream_timeout` error frame and the response closes without `[DONE]`

#### Scenario: Mid-stream errors stay safe

- **WHEN** a mid-stream failure carries a unique sensitive sentinel in its message or payload
- **THEN** the error frame contains none of that sentinel and only the defined error fields

### Requirement: Streaming backpressure

The endpoint SHALL write at most one frame at a time and SHALL NOT read the next adapter event until the current frame has drained. When a write signals backpressure, the endpoint SHALL wait for drain or termination rather than buffering subsequent events.

#### Scenario: Slow consumer applies backpressure

- **WHEN** a client stops reading while the adapter yields more deltas
- **THEN** the endpoint stops consuming the iterator, does not accumulate an unbounded queue, and resumes only after the response drains

### Requirement: Request deadline

The request deadline SHALL be enforced from admission using `REQUEST_TIMEOUT_MS`. On expiry the adapter signal SHALL be aborted, the response SHALL terminate through the applicable pre-commit or mid-stream error path, and the permit SHALL be released.

#### Scenario: Deadline aborts adapter work

- **WHEN** the request deadline expires while the adapter is still producing
- **THEN** the adapter signal is aborted, the stream terminates through the applicable error path, and the permit is released

### Requirement: Streaming cancellation and cleanup

Client disconnect, deadline expiry, shutdown, or an iterator failure SHALL abort the adapter signal, stop further reads, close the iterator, release the admission permit, and clear the deadline timer. No frame SHALL be written after the response closes, and no unhandled rejection or orphaned timer SHALL remain. Cancellation SHALL NOT fabricate usage counts or a `[DONE]` frame.

#### Scenario: Client disconnects mid-stream

- **WHEN** the client closes the connection after receiving at least one chunk
- **THEN** the adapter observes abort, the iterator is closed, the permit is released, and no further writes are attempted

#### Scenario: Abort before any chunk

- **WHEN** the client disconnects or the deadline expires before the first frame is committed
- **THEN** no SSE body is written, the adapter is aborted, and the request ends without a `[DONE]` frame

#### Scenario: Cancelled stream reports no usage

- **WHEN** a stream is cancelled before the adapter emits usage
- **THEN** no usage chunk is emitted and no token counts are invented

### Requirement: Deterministic default streaming composition

The default process SHALL stream the fixed mock content as the deltas `Mock ` and `response.` followed by usage input 1, output 1, cache-read 0, and finish reason `stop`, without timers, network access, or credentials. Streamed content SHALL be independent of submitted text and SHALL NOT claim actual token measurement.

#### Scenario: Default stream fixture succeeds

- **WHEN** the default process receives a valid `mock-chat` request with `stream: true`
- **THEN** the concatenated content frames equal `Mock response.`, exactly one finish chunk reports `stop`, and the stream ends with `[DONE]`
