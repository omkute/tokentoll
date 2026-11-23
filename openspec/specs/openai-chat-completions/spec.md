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

The request SHALL be a JSON object with required `model` and `messages`, and only optional `max_completion_tokens` and `stream`. Model SHALL be a non-blank string without coercion or trimming for alias matching. Messages SHALL contain 1–128 objects with only `role` and `content`. Roles SHALL be `system`, `user`, or `assistant`; content SHALL be a non-blank string preserved exactly. Unknown fields at either level SHALL be rejected.

#### Scenario: Ordered text messages are preserved

- **WHEN** a request supplies system, user, and assistant messages containing surrounding whitespace and Unicode text
- **THEN** translation preserves their roles, order, and exact content

#### Scenario: Invalid or unsupported request shape

- **WHEN** a body is null, an array, or a scalar; lacks a required field; contains empty or more than 128 messages; has a null/blank/non-string content; uses a tool/developer role or content array; or contains any extra root/message field
- **THEN** it returns 400 with code `invalid_request` and no adapter invocation

#### Scenario: Unsupported controls are rejected

- **WHEN** a request includes `max_tokens`, `temperature`, `n`, `tools`, `response_format`, or a client-supplied tenant field
- **THEN** it returns 400 with code `invalid_request` without silently dropping the field

### Requirement: Non-streaming and output limit controls

When present, `stream` SHALL be exactly boolean false, and `max_completion_tokens` SHALL be an integer between 1 and 8192 inclusive. Explicit nulls and coerced values SHALL be rejected. Omitted stream SHALL mean non-streaming; omitted output limit SHALL remain absent in the neutral request. A supplied output limit SHALL translate to neutral `maxOutputTokens`.

#### Scenario: Accepted optional controls

- **WHEN** a valid request omits optional fields or supplies `stream: false` and an integer output limit of 1 or 8192
- **THEN** it succeeds with JSON and only the supplied output limit appears in the neutral invocation

#### Scenario: Invalid optional controls

- **WHEN** stream is true, null, or a string, or the output limit is null, zero, negative, fractional, a string, or greater than 8192
- **THEN** it returns 400 with code `invalid_request` and no adapter invocation

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

The endpoint SHALL accept only `application/json` with optional UTF-8 charset and uncompressed bodies up to 65,536 bytes inclusive. Other media types, non-UTF-8 charsets, or non-identity content encodings SHALL return 415. Response content SHALL be at most 8192 UTF-8 bytes; the serialized success body SHALL be at most 65,536 UTF-8 bytes. Response overflow SHALL return 502 `invalid_provider_response` without truncation or partial output.

#### Scenario: Exact body boundary

- **WHEN** valid JSON with padding is exactly 65,536 bytes, or is 65,537 bytes with or without a content-length header
- **THEN** the exact-limit body is accepted and the oversized body returns 413 before adapter invocation

#### Scenario: Media type enforcement

- **WHEN** the request uses UTF-8 application/json, or instead uses text/plain, a missing content type, a non-UTF-8 charset, or gzip encoding
- **THEN** JSON is accepted and each unsupported representation returns 415 without adapter invocation

#### Scenario: Response bounds use encoded bytes

- **WHEN** valid adapter text is exactly 8192 UTF-8 bytes, or exceeds it by one byte
- **THEN** the exact-limit result succeeds within the serialized bound and the oversized result returns 502 without truncation
- **AND** Unicode and JSON escaping are included in byte-boundary tests

### Requirement: Bounded admission and cleanup

At most 64 adapter invocations SHALL be active per application instance. An additional validated request SHALL fail immediately with 503 `gateway_busy` of type `server_error`; it SHALL NOT queue or invoke the adapter. Capacity SHALL be released on success, adapter rejection, invalid output, and serialization failure. Health probes SHALL remain independent of this bound.

#### Scenario: Saturation and recovery

- **WHEN** 64 admitted invocations are held active and another valid request arrives
- **THEN** the additional request returns 503 `gateway_busy` without an invocation, while health returns 200
- **AND** completion or rejection of held invocations releases capacity for later requests

### Requirement: Sensitive data and lifecycle preservation

The proxy SHALL NOT log request/response content, headers, credentials, submitted values, or raw exceptions. It SHALL preserve existing health and graceful shutdown behavior and SHALL introduce no network clients, workers, queues, or timers. The immediate default mock SHALL drain during shutdown; real upstream deadlines and cancellation remain M4 work.

#### Scenario: Sensitive paths remain quiet

- **WHEN** requests exercise success, validation failure, provider failure, unexpected exception, and overflow with sensitive sentinels in content and headers
- **THEN** captured logs contain none of the sensitive sentinels or raw exception data

#### Scenario: Production startup and shutdown include the proxy

- **WHEN** the built Node.js process serves a default completion and receives SIGINT or SIGTERM
- **THEN** health and completion behavior are correct, the listener closes within the configured grace period, and the process exits successfully
