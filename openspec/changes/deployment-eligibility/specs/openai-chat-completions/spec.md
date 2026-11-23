# Spec Delta

## MODIFIED Requirements

### Requirement: Supported endpoint and model

The service SHALL expose `POST /v1/chat/completions` without requiring authentication. It SHALL accept only the exact model alias `mock-chat`, resolved to an ordered catalog of candidate deployments for that alias. It SHALL return HTTP 404 with code `model_not_found` for any other non-blank string model. Model discovery and other generation endpoints SHALL remain unavailable.

#### Scenario: Fixed model is available

- **WHEN** a client posts a valid request for `mock-chat` without an authorization header
- **THEN** the request succeeds through an eligible mock adapter without credentials or network access

#### Scenario: Unknown model

- **WHEN** an otherwise valid request specifies model `other-model`
- **THEN** it returns 404 with code `model_not_found`, param `model`, and no adapter invocation

### Requirement: Neutral adapter forwarding

Each admitted valid request SHALL invoke the selected eligible adapter exactly once with a validated neutral request and the selected unified deployment. Wire fields `model`, `stream`, and `max_completion_tokens` SHALL NOT enter neutral contracts. There SHALL be no retries, fallback, or provider-specific payload escape hatch.

#### Scenario: Invocation is observed

- **WHEN** a valid HTTP request is sent with an output limit of 16
- **THEN** the adapter receives only ordered neutral messages, `maxOutputTokens: 16`, and the selected eligible deployment, and its invocation count is one

### Requirement: Stable HTTP error classification

Request validation SHALL return 400; unsupported media type SHALL return 415; body overflow SHALL return 413; unknown model SHALL return 404; no eligible deployment SHALL return 503 `deployment_unavailable`. Neutral failures SHALL map by category regardless of retryability. Unknown exceptions SHALL return 500 `internal_error`, and invalid adapter results SHALL return 502 `invalid_provider_response`. The endpoint SHALL emit no retry instructions or extra provider-derived error fields.

#### Scenario: Boundary failures are classified

- **WHEN** a request fails boundary validation
- **THEN** the status, type, and code match this table

| Failure | HTTP | Type | Code |
| --- | --- | --- | --- |
| Invalid shape, unsupported field, empty body, malformed JSON | 400 | invalid_request_error | invalid_request |
| Unknown non-blank model | 404 | invalid_request_error | model_not_found |
| Request body overflow | 413 | invalid_request_error | request_too_large |
| Missing or unsupported content type | 415 | invalid_request_error | unsupported_media_type |
| Known model with no eligible deployment | 503 | server_error | deployment_unavailable |

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

## ADDED Requirements

### Requirement: Deployment eligibility at the endpoint

After request validation and model alias resolution, the endpoint SHALL evaluate the deployment catalog before admission and invoke only an eligible deployment's adapter. When no deployment is eligible, the endpoint SHALL return 503 `deployment_unavailable` with the fixed safe envelope, consume no admission permit, and invoke no adapter.

#### Scenario: Ineligible targets are never invoked

- **WHEN** every catalog deployment for `mock-chat` is disabled, lacks a required capability, or is too small for the context estimate
- **THEN** the request returns 503 with code `deployment_unavailable` and no adapter is invoked

#### Scenario: Streaming requires streaming eligibility

- **WHEN** the only eligible deployment declares `generation` but not `streaming` and the request sets `stream: true`
- **THEN** the request returns 503 with code `deployment_unavailable` and no SSE response is started

#### Scenario: Eligibility precedes admission

- **WHEN** eligibility fails while the application is at its admission limit
- **THEN** the response remains `deployment_unavailable` and no admission permit is consumed

#### Scenario: Unknown model is not an eligibility failure

- **WHEN** a request names an unknown model alias while the catalog is non-empty
- **THEN** the response remains 404 `model_not_found` rather than `deployment_unavailable`
