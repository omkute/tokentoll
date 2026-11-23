# Spec Delta

## Purpose

Defines how candidate model deployments are cataloged, evaluated against a request's explicit requirements, and selected before any provider adapter work begins.

## ADDED Requirements

### Requirement: Deployment catalog integrity

The gateway SHALL hold an ordered catalog of one or more model deployments. Every catalog deployment SHALL have a unique deployment identifier, and every deployment `adapterId` SHALL resolve to a registered adapter. An empty catalog, a duplicate deployment identifier, or an unresolved adapter identifier SHALL fail startup before an HTTP listener is opened.

#### Scenario: Valid catalog is accepted

- **WHEN** the catalog contains deployments with distinct identifiers and every adapter identifier resolves
- **THEN** catalog construction succeeds and preserves the supplied deployment order

#### Scenario: Duplicate deployment identifier

- **WHEN** two catalog entries share the same deployment identifier
- **THEN** catalog construction fails and the process does not open an HTTP listener

#### Scenario: Adapter identifier is unresolved

- **WHEN** a catalog deployment names an adapter identifier with no registered adapter
- **THEN** catalog construction fails and the process does not open an HTTP listener

### Requirement: Explicit enablement eligibility

A deployment SHALL be eligible only when its explicit `enabled` fact is `true`. Disabled deployments MUST remain describable in the catalog but MUST NOT be selected or invoked.

#### Scenario: Disabled deployment is skipped

- **WHEN** a request would otherwise match a disabled deployment
- **THEN** that deployment is ineligible and is not invoked

#### Scenario: All matches are disabled

- **WHEN** every deployment matching the requested model is disabled
- **THEN** no deployment is eligible and no adapter is invoked

### Requirement: Capability eligibility

A deployment SHALL be eligible only when it declares every capability the request requires and the registered adapter exposes the corresponding operation. A non-streaming request SHALL require `generation`; a streaming request SHALL also require `streaming`.

#### Scenario: Streaming deployment is required

- **WHEN** a streaming request is evaluated against a deployment that lacks the declared `streaming` capability
- **THEN** that deployment is ineligible

#### Scenario: Adapter operation is missing

- **WHEN** a deployment declares `streaming` but its registered adapter exposes no streaming operation
- **THEN** that deployment is ineligible for a streaming request

#### Scenario: Generation capability is required

- **WHEN** a deployment lacks the declared `generation` capability
- **THEN** it is ineligible for every chat completion request

### Requirement: Context-window eligibility

A deployment SHALL be eligible only when its declared context window is at least the request's conservative context estimate. The estimate SHALL be the sum of each message's UTF-8 byte length, four tokens per message for framing, and the supplied output limit, or 8192 tokens when no output limit is supplied.

#### Scenario: Estimate fits exactly

- **WHEN** the context estimate equals the deployment's declared context window
- **THEN** the deployment is eligible for that request

#### Scenario: Estimate exceeds the window

- **WHEN** the context estimate exceeds the deployment's declared context window by any amount
- **THEN** the deployment is ineligible

#### Scenario: Omitted output limit reserves the maximum

- **WHEN** a request omits the output limit
- **THEN** the estimate reserves 8192 output tokens before comparing against the context window

### Requirement: Deterministic eligible selection

The gateway SHALL select the first eligible deployment in catalog order. Catalog order is the explicit operator preference, and selection MUST NOT depend on prices, provider identity, request content, or any random or time-based value.

#### Scenario: Catalog order decides

- **WHEN** more than one deployment is eligible for a request
- **THEN** the earliest eligible deployment in catalog order is selected

#### Scenario: Ineligible entries are skipped

- **WHEN** the first catalog entry is ineligible but a later entry is eligible
- **THEN** the later eligible entry is selected

#### Scenario: No eligible deployment

- **WHEN** the catalog contains no eligible deployment for a known model
- **THEN** selection reports no eligible deployment and no adapter is invoked

### Requirement: No eligible deployment outcome

When a request names a known model alias and no deployment is eligible, the gateway SHALL fail with the `deployment_unavailable` code before admission, consume no admission permit, and invoke no adapter. The outcome MUST NOT reveal deployment identifiers, adapter identifiers, contexts, or prices.

#### Scenario: Known model has no eligible target

- **WHEN** a valid request names `mock-chat` and every matching deployment is ineligible
- **THEN** the request fails with `deployment_unavailable` and no adapter is invoked

#### Scenario: Ineligible request is not admitted

- **WHEN** eligibility fails while all 64 admission permits are held
- **THEN** the request still reports `deployment_unavailable` rather than `gateway_busy`
