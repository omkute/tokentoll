# Spec Delta

## Purpose

Defines one provider-neutral descriptor for every provider/model target so later eligibility and routing logic can reason over deployments consistently.

## ADDED Requirements

### Requirement: Unified model deployment descriptor

Every provider/model target SHALL use the same model-deployment contract with a stable deployment identifier, adapter identifier, provider model identifier, capability facts, context limit, and configured token prices. Provider origin, nationality, or market labels MUST NOT create different entity types.

#### Scenario: Deployment is described

- **WHEN** a provider/model target is registered as a model deployment
- **THEN** it is represented by the unified descriptor regardless of provider identity or model category

#### Scenario: Provider-specific deployment shape is supplied

- **WHEN** a deployment uses provider-specific fields or a provider-specific entity subtype
- **THEN** descriptor validation rejects it as a unified model deployment

### Requirement: Stable deployment identity

A model deployment SHALL identify the deployment, the adapter that owns provider translation, and the provider-side model target with non-empty stable strings. These identifiers MUST be sufficient to distinguish multiple deployments of the same provider model.

#### Scenario: Multiple deployments share a model target

- **WHEN** two deployments reference the same adapter and provider-side model identifier
- **THEN** each deployment remains distinguishable by its own deployment identifier

#### Scenario: Deployment identity is incomplete

- **WHEN** any required deployment, adapter, or provider-model identifier is empty or whitespace-only
- **THEN** descriptor validation rejects the deployment

### Requirement: Deployment capability and context facts

A model deployment SHALL declare its supported neutral capabilities and a positive integer context-token limit. Capability facts MUST be explicit values consumed uniformly rather than inferred from provider names or labels.

#### Scenario: Capability facts are inspected

- **WHEN** a caller evaluates a deployment's supported operations and context limit
- **THEN** it reads explicit neutral capability facts from the unified descriptor

#### Scenario: Context limit is invalid

- **WHEN** a deployment declares a zero, negative, or fractional context-token limit
- **THEN** descriptor validation rejects the deployment

### Requirement: Consistent token-price fields

A model deployment SHALL declare non-negative input, output, and cache-read token rates using the same currency and unit fields for every deployment. Missing, negative, fractional fixed-unit, or provider-specific price fields MUST be rejected.

#### Scenario: Deployment prices are comparable

- **WHEN** two valid deployment descriptors are inspected
- **THEN** their input, output, and cache-read rates use the same contract and explicit currency and unit semantics

#### Scenario: Deployment price is invalid

- **WHEN** a required token rate is missing, negative, fractional in its fixed unit, or represented by a provider-specific field
- **THEN** descriptor validation rejects the deployment
