# Spec Delta

## MODIFIED Requirements

### Requirement: Unified model deployment descriptor

Every provider/model target SHALL use the same model-deployment contract with a stable deployment identifier, adapter identifier, provider model identifier, capability facts, context limit, configured token prices, and an explicit operator `enabled` fact. Provider origin, nationality, or market labels MUST NOT create different entity types.

#### Scenario: Deployment is described

- **WHEN** a provider/model target is registered as a model deployment
- **THEN** it is represented by the unified descriptor regardless of provider identity or model category
- **AND** its descriptor states whether the operator has enabled it

#### Scenario: Provider-specific deployment shape is supplied

- **WHEN** a deployment uses provider-specific fields or a provider-specific entity subtype
- **THEN** descriptor validation rejects it as a unified model deployment

#### Scenario: Enablement is explicit

- **WHEN** a deployment omits `enabled` or supplies a non-boolean value
- **THEN** descriptor validation rejects the deployment

#### Scenario: Disabled deployment remains describable

- **WHEN** a valid deployment supplies `enabled: false`
- **THEN** descriptor validation accepts it and marks it unavailable for selection
