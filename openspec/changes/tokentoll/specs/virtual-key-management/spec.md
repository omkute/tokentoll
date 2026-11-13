# Spec Delta

## Purpose

Manages virtual API key lifecycle, authorization scopes, rate limits, spending caps, and secure encrypted mapping to upstream AI provider credentials.

## ADDED Requirements

### Requirement: Virtual Key Generation and Secure Storage
The system SHALL generate high-entropy virtual API keys with a recognizable prefix and store only one-way cryptographic hashes in the database, displaying the raw secret key only once upon creation.

#### Scenario: Virtual key creation
- **WHEN** an authorized administrator requests a new virtual API key for a team
- **THEN** the system generates a raw secret prefixed with `tt_`, stores its SHA-256 hash in PostgreSQL, and returns the raw key in the initial response only

#### Scenario: Key authentication lookup
- **WHEN** a client sends an HTTP request with a virtual key in the `Authorization: Bearer <key>` header
- **THEN** the system computes the SHA-256 hash, looks up the active key metadata in memory/cache, and resolves tenant identity without storing plain-text keys

### Requirement: Granular Virtual Key Scoping
The system SHALL enforce granular authorization policies per virtual key, including allowed model identifiers, maximum rate limits, spending caps, and expiration timestamps.

#### Scenario: Request matching allowed model
- **WHEN** a request arrives using a virtual key scoped exclusively to `gpt-4o-mini` requesting `gpt-4o-mini`
- **THEN** the system permits the request to proceed to the serving pipeline

#### Scenario: Request exceeding model scope
- **WHEN** a request arrives using a virtual key scoped only to `gpt-4o-mini` attempting to invoke `claude-3-5-sonnet`
- **THEN** the system rejects the request with an HTTP 403 Forbidden error indicating unauthorized model access

### Requirement: Upstream Provider Credential Vault
The system SHALL securely store upstream LLM provider API credentials using AES-256-GCM encryption at rest across supported frontier and high-efficiency providers (OpenAI, Anthropic, Gemini, Azure, DeepSeek, Qwen, Moonshot, Zhipu, Mistral, Groq), dynamically resolving secrets and base URLs during upstream dispatch.

#### Scenario: Upstream request dispatch with masked credentials
- **WHEN** the gateway proxies an authorized request to an upstream provider endpoint
- **THEN** the system decrypts the corresponding upstream provider key in memory, injects it into the upstream request header, and ensures it is never logged or leaked to clients

#### Scenario: Cost-effective Chinese provider credential resolution
- **WHEN** an authorized request targets a provider such as DeepSeek, Alibaba Cloud Qwen, Moonshot, or Zhipu
- **THEN** the system resolves the encrypted provider key and target regional base URL, authenticates the upstream call, and prevents credential leakage

#### Scenario: Immediate key revocation
- **WHEN** an administrator revokes a virtual key or an upstream provider key
- **THEN** the system invalidates the cached key immediately and rejects subsequent requests using that virtual key with an HTTP 401 Unauthorized status
